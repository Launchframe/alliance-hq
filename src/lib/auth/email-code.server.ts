import "server-only";

import { randomInt } from "node:crypto";

import { and, desc, eq, gt } from "drizzle-orm";
import { nanoid } from "nanoid";

import { normalizeAshedEmail } from "@/lib/alliance/accessible";
import { buildAuthCodeEmail } from "@/lib/auth/auth-code-email.server";
import { getDb, schema } from "@/lib/db";
import { resolvePreAuthEmailLocale } from "@/lib/notifications/locale.server";
import { assertEmailSignInAllowed } from "@/lib/auth/email-sign-in-restriction.server";
import {
  PRODUCTION_EMAIL_FROM,
  RESEND_DEV_EMAIL_FROM,
} from "@/lib/public-site";

export const AUTH_EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
export const AUTH_EMAIL_CODE_RATE_LIMIT_MS = 60 * 1000;
export const AUTH_EMAIL_CODE_MAX_VERIFY_ATTEMPTS = 5;

export class AuthEmailCodeError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_email" | "rate_limited" | "send_failed",
  ) {
    super(message);
    this.name = "AuthEmailCodeError";
  }
}

export function generateAuthEmailCode(): string {
  return String(randomInt(100_000, 1_000_000));
}

function resolveEmailFromAddress(): string {
  return (
    process.env.EMAIL_FROM ??
    (process.env.NODE_ENV === "production"
      ? PRODUCTION_EMAIL_FROM
      : RESEND_DEV_EMAIL_FROM)
  );
}

function shouldLogAuthEmailCodeToStdout(): boolean {
  return process.env.NODE_ENV !== "production";
}

function logAuthEmailCodeToStdout(email: string, code: string): void {
  console.log(
    `\n[alliance-hq] Email verification code for ${email} (dev only — do not share in production):\n${code}\n`,
  );
}

async function sendAuthEmailCodeViaResend(input: {
  to: string;
  code: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured.");
  }

  const from = resolveEmailFromAddress();
  const email = buildAuthCodeEmail(
    "verify",
    input.code,
    await resolvePreAuthEmailLocale(),
  );
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: input.to,
      ...email,
    }),
  });

  if (!res.ok) {
    throw new Error(`Resend error: ${JSON.stringify(await res.json())}`);
  }
}

export async function issueAuthEmailCode(rawEmail: string): Promise<void> {
  const email = normalizeAshedEmail(rawEmail);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AuthEmailCodeError("Invalid email.", "invalid_email");
  }

  await assertEmailSignInAllowed(email);

  if (
    process.env.E2E_TEST === "true" &&
    email.endsWith("@alliance-hq.test")
  ) {
    const e2eCode = process.env.E2E_EMAIL_CODE?.trim() ?? "";
    if (!/^[0-9]{6}$/.test(e2eCode)) {
      throw new AuthEmailCodeError(
        "E2E email verification is misconfigured.",
        "send_failed",
      );
    }
    const db = getDb();
    const now = new Date();
    await db.delete(schema.authEmailCodes).where(eq(schema.authEmailCodes.email, email));
    await db.insert(schema.authEmailCodes).values({
      id: nanoid(16),
      email,
      code: e2eCode,
      failedAttempts: 0,
      expiresAt: new Date(now.getTime() + AUTH_EMAIL_CODE_TTL_MS),
      createdAt: now,
    });
    return;
  }

  const db = getDb();
  const now = new Date();
  const rateLimitCutoff = new Date(now.getTime() - AUTH_EMAIL_CODE_RATE_LIMIT_MS);

  const [recent] = await db
    .select({ id: schema.authEmailCodes.id })
    .from(schema.authEmailCodes)
    .where(
      and(
        eq(schema.authEmailCodes.email, email),
        gt(schema.authEmailCodes.createdAt, rateLimitCutoff),
      ),
    )
    .orderBy(desc(schema.authEmailCodes.createdAt))
    .limit(1);

  if (recent) {
    throw new AuthEmailCodeError(
      "Please wait before requesting another code.",
      "rate_limited",
    );
  }

  await db.delete(schema.authEmailCodes).where(eq(schema.authEmailCodes.email, email));

  const code = generateAuthEmailCode();
  await db.insert(schema.authEmailCodes).values({
    id: nanoid(16),
    email,
    code,
    failedAttempts: 0,
    expiresAt: new Date(now.getTime() + AUTH_EMAIL_CODE_TTL_MS),
    createdAt: now,
  });

  const devLog = shouldLogAuthEmailCodeToStdout();
  if (devLog) {
    logAuthEmailCodeToStdout(email, code);
    if (isAuthEmailCodeLogOnly()) {
      return;
    }
  }

  try {
    await sendAuthEmailCodeViaResend({ to: email, code });
  } catch (error) {
    if (devLog) {
      console.warn(
        "[alliance-hq] Resend send failed in dev; use the verification code printed above.",
        error instanceof Error ? error.message : error,
      );
      return;
    }
    throw new AuthEmailCodeError("Failed to send verification code.", "send_failed");
  }
}

export function isAuthEmailCodeLogOnly(): boolean {
  const flag = process.env.AUTH_EMAIL_CODE_LOG_ONLY?.trim().toLowerCase();
  if (flag === "1" || flag === "true" || flag === "yes") {
    return true;
  }
  return isMagicLinkLogOnlyFallback();
}

function isMagicLinkLogOnlyFallback(): boolean {
  const flag = process.env.AUTH_MAGIC_LINK_LOG_ONLY?.trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

export async function verifyAuthEmailCode(
  rawEmail: string,
  rawCode: string,
): Promise<{ email: string } | null> {
  const email = normalizeAshedEmail(rawEmail);
  const code = rawCode.trim();
  if (!email || !/^[0-9]{6}$/.test(code)) {
    return null;
  }

  const db = getDb();
  const now = new Date();
  const [record] = await db
    .select({
      id: schema.authEmailCodes.id,
      email: schema.authEmailCodes.email,
      code: schema.authEmailCodes.code,
      failedAttempts: schema.authEmailCodes.failedAttempts,
    })
    .from(schema.authEmailCodes)
    .where(
      and(
        eq(schema.authEmailCodes.email, email),
        gt(schema.authEmailCodes.expiresAt, now),
      ),
    )
    .orderBy(desc(schema.authEmailCodes.createdAt))
    .limit(1);

  if (!record) {
    return null;
  }

  if (record.failedAttempts >= AUTH_EMAIL_CODE_MAX_VERIFY_ATTEMPTS) {
    await db
      .delete(schema.authEmailCodes)
      .where(eq(schema.authEmailCodes.id, record.id));
    return null;
  }

  if (record.code !== code) {
    const nextAttempts = record.failedAttempts + 1;
    if (nextAttempts >= AUTH_EMAIL_CODE_MAX_VERIFY_ATTEMPTS) {
      await db
        .delete(schema.authEmailCodes)
        .where(eq(schema.authEmailCodes.id, record.id));
    } else {
      await db
        .update(schema.authEmailCodes)
        .set({ failedAttempts: nextAttempts })
        .where(eq(schema.authEmailCodes.id, record.id));
    }
    return null;
  }

  await db
    .delete(schema.authEmailCodes)
    .where(eq(schema.authEmailCodes.id, record.id));

  return { email: record.email };
}
