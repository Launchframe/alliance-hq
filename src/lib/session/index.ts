import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { redirect } from "next/navigation";

import { decryptSecret, encryptSecret } from "@/lib/crypto/encrypt";
import type { ParsedConnection } from "@/lib/connectionString";
import { getDb, schema } from "@/lib/db";
import type { Session } from "@/lib/db/schema";

export const SESSION_COOKIE = "alliance_hq_session";
const SESSION_DAYS = 90;

function sessionExpiry(): Date {
  const d = new Date();
  d.setDate(d.getDate() + SESSION_DAYS);
  return d;
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}

export async function readSessionId(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE)?.value;
}

export async function loadSession(sessionId: string): Promise<Session | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);

  if (!row || row.expiresAt <= new Date()) {
    return null;
  }

  return row;
}

/** For Server Components — redirects to bootstrap if no valid session. */
export async function requirePageSession(returnTo = "/"): Promise<Session> {
  const sessionId = await readSessionId();
  if (sessionId) {
    const existing = await loadSession(sessionId);
    if (existing) {
      return existing;
    }
  }

  const next = returnTo.startsWith("/") ? returnTo : `/${returnTo}`;
  redirect(`/api/auth/session?next=${encodeURIComponent(next)}`);
}

/** For Route Handlers — creates DB row and sets cookie on the response. */
export async function bootstrapSessionResponse(
  redirectTo: string,
  requestUrl: string,
): Promise<NextResponse> {
  const id = nanoid(32);
  const expiresAt = sessionExpiry();
  const now = new Date();
  const db = getDb();

  await db.insert(schema.sessions).values({
    id,
    createdAt: now,
    updatedAt: now,
    expiresAt,
  });

  const target = redirectTo.startsWith("/")
    ? new URL(redirectTo, requestUrl)
    : new URL("/", requestUrl);

  const response = NextResponse.redirect(target);
  response.cookies.set(SESSION_COOKIE, id, sessionCookieOptions(expiresAt));
  return response;
}

/** For Route Handlers — read or create session (cookies may be set). */
export async function getOrCreateSession(): Promise<Session> {
  const sessionId = await readSessionId();
  if (sessionId) {
    const existing = await loadSession(sessionId);
    if (existing) {
      return existing;
    }
  }

  const id = nanoid(32);
  const expiresAt = sessionExpiry();
  const now = new Date();

  const db = getDb();
  await db.insert(schema.sessions).values({
    id,
    createdAt: now,
    updatedAt: now,
    expiresAt,
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, id, sessionCookieOptions(expiresAt));

  return {
    id,
    userLabel: null,
    createdAt: now,
    updatedAt: now,
    expiresAt,
  };
}

export async function getAshedConnection(
  sessionId: string,
): Promise<ParsedConnection | null> {
  const db = getDb();
  const [cred] = await db
    .select()
    .from(schema.ashedCredentials)
    .where(eq(schema.ashedCredentials.sessionId, sessionId))
    .limit(1);

  if (!cred) {
    return null;
  }

  return {
    appId: cred.appId,
    originUrl: cred.originUrl,
    token: decryptSecret(cred.encryptedToken),
  };
}

export async function storeAshedConnection(
  sessionId: string,
  connection: ParsedConnection,
  userLabel: string | null,
) {
  const db = getDb();
  const now = new Date();
  const encryptedToken = encryptSecret(connection.token);

  const [existing] = await db
    .select({ id: schema.ashedCredentials.id })
    .from(schema.ashedCredentials)
    .where(eq(schema.ashedCredentials.sessionId, sessionId))
    .limit(1);

  if (existing) {
    await db
      .update(schema.ashedCredentials)
      .set({
        appId: connection.appId,
        originUrl: connection.originUrl,
        encryptedToken,
        updatedAt: now,
      })
      .where(eq(schema.ashedCredentials.id, existing.id));
  } else {
    await db.insert(schema.ashedCredentials).values({
      id: nanoid(24),
      sessionId,
      appId: connection.appId,
      originUrl: connection.originUrl,
      encryptedToken,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (userLabel) {
    await db
      .update(schema.sessions)
      .set({ userLabel, updatedAt: now })
      .where(eq(schema.sessions.id, sessionId));
  }
}

export async function clearAshedConnection(sessionId: string) {
  const db = getDb();
  await db
    .delete(schema.ashedCredentials)
    .where(eq(schema.ashedCredentials.sessionId, sessionId));

  await db
    .update(schema.sessions)
    .set({ userLabel: null, updatedAt: new Date() })
    .where(eq(schema.sessions.id, sessionId));
}

export async function getSessionStateFor(session: Session) {
  const connection = await getAshedConnection(session.id);

  return {
    sessionId: session.id,
    userLabel: session.userLabel,
    isConnected: connection !== null,
    expiresAt: session.expiresAt.toISOString(),
  };
}

export async function getSessionState() {
  const session = await getOrCreateSession();
  return getSessionStateFor(session);
}

export async function getPageSessionState(returnTo = "/") {
  const session = await requirePageSession(returnTo);
  return getSessionStateFor(session);
}
