import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { nanoid } from "nanoid";

import { mintNextAuthSessionToken, nextAuthSessionCookieName } from "@/lib/auth/dev-session.server";
import { DEFAULT_APP_ID } from "@/lib/connectionString";
import { encryptSecret } from "@/lib/crypto/encrypt";
import { getDb, schema } from "@/lib/db";
import { isDevOrPreviewEnvironment } from "@/lib/dev/env-guard";
import { findTestMatrixAccount, type TestMatrixAccount } from "@/lib/dev/test-matrix";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export const dynamic = "force-dynamic";

const RETURN_COOKIE = "dev_switch_return";
const ASHED_ALLIANCE_SLUG = "test-matrix-ashed";
const SESSION_DAYS = 90;
const FAKE_TOKEN_TTL_DAYS = 30;

const AUTH_COOKIE_NAMES = [
  "__Secure-authjs.session-token",
  "authjs.session-token",
] as const;

type ReturnState = {
  sessionId: string | null;
  authCookieName: string | null;
  authToken: string | null;
};

function notFound(): NextResponse {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

function requestIsSecure(request: NextRequest): boolean {
  if (request.headers.get("x-forwarded-proto") === "https") {
    return true;
  }
  return request.nextUrl.protocol === "https:";
}

function expiry(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function readExistingAuthCookie(
  jar: Awaited<ReturnType<typeof cookies>>,
): { name: string; value: string } | null {
  for (const name of AUTH_COOKIE_NAMES) {
    const value = jar.get(name)?.value;
    if (value) {
      return { name, value };
    }
  }
  return null;
}

async function resolveAllianceForAccount(
  account: TestMatrixAccount,
  hqUserId: string,
): Promise<{ allianceId: string | null; allianceTag: string | null }> {
  const db = getDb();

  if (account.role) {
    const [row] = await db
      .select({
        allianceId: schema.allianceMemberships.allianceId,
        allianceTag: schema.alliances.tag,
      })
      .from(schema.allianceMemberships)
      .innerJoin(
        schema.alliances,
        eq(schema.alliances.id, schema.allianceMemberships.allianceId),
      )
      .where(
        and(
          eq(schema.allianceMemberships.hqUserId, hqUserId),
          eq(schema.allianceMemberships.status, "active"),
        ),
      )
      .limit(1);
    return {
      allianceId: row?.allianceId ?? null,
      allianceTag: row?.allianceTag ?? null,
    };
  }

  // Platform maintainer: anchor to the ashed-mode test alliance for tenant context.
  const [row] = await db
    .select({ id: schema.alliances.id, tag: schema.alliances.tag })
    .from(schema.alliances)
    .where(eq(schema.alliances.slug, ASHED_ALLIANCE_SLUG))
    .limit(1);
  return { allianceId: row?.id ?? null, allianceTag: row?.tag ?? null };
}

async function attachFakeAshedCredential(
  sessionId: string,
  account: TestMatrixAccount,
): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db.insert(schema.ashedCredentials).values({
    id: nanoid(24),
    sessionId,
    ashedUserId: account.ashedUserId,
    appId: process.env.BASE44_APP_ID?.trim() || DEFAULT_APP_ID,
    originUrl: process.env.BASE44_ORIGIN_URL?.trim() || "https://ashed.online",
    encryptedToken: encryptSecret(`dev-test-matrix:${account.email}`),
    tokenExpiresAt: expiry(FAKE_TOKEN_TTL_DAYS),
    createdAt: now,
    updatedAt: now,
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isDevOrPreviewEnvironment()) {
    return notFound();
  }

  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const account = findTestMatrixAccount(email);
  if (!account) {
    return NextResponse.json({ error: "unknown_account" }, { status: 400 });
  }

  const db = getDb();
  const [user] = await db
    .select({ id: schema.hqUsers.id })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.email, account.email.toLowerCase()))
    .limit(1);
  if (!user) {
    return NextResponse.json(
      { error: "not_seeded", hint: "Run npm run seed:test-matrix" },
      { status: 409 },
    );
  }

  const { allianceId, allianceTag } = await resolveAllianceForAccount(
    account,
    user.id,
  );

  const now = new Date();
  const sessionExpiresAt = expiry(SESSION_DAYS);
  const newSessionId = nanoid(32);
  await db.insert(schema.sessions).values({
    id: newSessionId,
    hqUserId: user.id,
    currentAllianceId: allianceId,
    allianceId,
    allianceTag,
    userLabel: account.displayName,
    createdAt: now,
    updatedAt: now,
    expiresAt: sessionExpiresAt,
  });

  if (account.ashed) {
    await attachFakeAshedCredential(newSessionId, account);
  }

  const secure = requestIsSecure(request);
  const jar = await cookies();

  // Stash the caller's real session once so Exit always returns to them.
  if (!jar.get(RETURN_COOKIE)) {
    const existingAuth = readExistingAuthCookie(jar);
    const returnState: ReturnState = {
      sessionId: jar.get(SESSION_COOKIE)?.value ?? null,
      authCookieName: existingAuth?.name ?? null,
      authToken: existingAuth?.value ?? null,
    };
    jar.set(RETURN_COOKIE, JSON.stringify(returnState), {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      expires: sessionExpiresAt,
    });
  }

  const authToken = await mintNextAuthSessionToken({
    hqUserId: user.id,
    email: account.email,
    name: account.displayName,
  });

  jar.set(SESSION_COOKIE, newSessionId, sessionCookieOptions(sessionExpiresAt));
  jar.set(nextAuthSessionCookieName(secure), authToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    expires: sessionExpiresAt,
  });

  return NextResponse.json({ ok: true, email: account.email });
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  if (!isDevOrPreviewEnvironment()) {
    return notFound();
  }

  const secure = requestIsSecure(request);
  const jar = await cookies();
  const raw = jar.get(RETURN_COOKIE)?.value;

  let restored: ReturnState | null = null;
  if (raw) {
    try {
      restored = JSON.parse(raw) as ReturnState;
    } catch {
      restored = null;
    }
  }

  // Always clear the assumed auth cookies first.
  for (const name of AUTH_COOKIE_NAMES) {
    jar.delete(name);
  }

  if (restored?.sessionId) {
    jar.set(
      SESSION_COOKIE,
      restored.sessionId,
      sessionCookieOptions(expiry(SESSION_DAYS)),
    );
  } else {
    jar.delete(SESSION_COOKIE);
  }

  if (restored?.authCookieName && restored.authToken) {
    jar.set(restored.authCookieName, restored.authToken, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      expires: expiry(SESSION_DAYS),
    });
  }

  jar.delete(RETURN_COOKIE);

  return NextResponse.json({ ok: true, restored: Boolean(restored?.sessionId) });
}
