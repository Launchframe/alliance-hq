import "server-only";

import { randomInt } from "node:crypto";

import { and, desc, eq, gt } from "drizzle-orm";
import { nanoid } from "nanoid";

import { normalizeAshedEmail } from "@/lib/alliance/accessible";
import { getDb, schema } from "@/lib/db";
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

function authEmailCodeHtml(code: string): string {
  return `
<body style="background: #0d1117; margin: 0; padding: 24px;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0"
    style="max-width: 480px; margin: auto; font-family: Helvetica, Arial, sans-serif;">
    <tr>
      <td style="padding: 24px; background: #161b22; border: 1px solid #30363d; border-radius: 12px;">
        <p style="margin: 0 0 8px; font-size: 18px; font-weight: 600; color: #e6edf3;">
          Verify your email
        </p>
        <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.5; color: #8b949e;">
          Enter this code on Alliance HQ to verify your email and finish creating your account.
        </p>
        <p style="margin: 0 0 20px; font-size: 32px; font-weight: 700; letter-spacing: 0.35em; text-align: center; color: #e6edf3;">
          ${code}
        </p>
        <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #6e7681;">
          This code expires in 10 minutes. If you did not request it, you can ignore this email.
        </p>
      </td>
    </tr>
  </table>
</body>`;
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
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: input.to,
      subject: `${input.code} is your Alliance HQ verification code`,
      html: authEmailCodeHtml(input.code),
      text: `Your Alliance HQ verification code is ${input.code}. It expires in 10 minutes.`,
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
