import "server-only";

import { createHash } from "node:crypto";

import { and, desc, eq, gt, ne } from "drizzle-orm";
import { nanoid } from "nanoid";

import { normalizeAshedEmail } from "@/lib/alliance/accessible";
import { buildAuthCodeEmail } from "@/lib/auth/auth-code-email.server";
import { writeAuditLog } from "@/lib/bff/audit";
import {
  AUTH_EMAIL_CODE_MAX_VERIFY_ATTEMPTS,
  AUTH_EMAIL_CODE_RATE_LIMIT_MS,
  AUTH_EMAIL_CODE_TTL_MS,
  generateAuthEmailCode,
} from "@/lib/auth/email-code.server";
import { getDb, schema } from "@/lib/db";
import {
  requestLocaleFallback,
  resolveRecipientLocale,
} from "@/lib/notifications/locale.server";
import {
  PRODUCTION_EMAIL_FROM,
  RESEND_DEV_EMAIL_FROM,
} from "@/lib/public-site";

export class ChangeHqEmailError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid_email"
      | "same_email"
      | "email_in_use"
      | "rate_limited"
      | "send_failed"
      | "invalid_code"
      | "not_found",
  ) {
    super(message);
    this.name = "ChangeHqEmailError";
  }
}

function hashEmailChangeCode(input: {
  hqUserId: string;
  newEmail: string;
  code: string;
}): string {
  return createHash("sha256")
    .update(`${input.hqUserId}:${input.newEmail}:${input.code.trim()}`)
    .digest("hex");
}

function resolveEmailFromAddress(): string {
  return (
    process.env.EMAIL_FROM ??
    (process.env.NODE_ENV === "production"
      ? PRODUCTION_EMAIL_FROM
      : RESEND_DEV_EMAIL_FROM)
  );
}

function shouldLogEmailChangeCodeToStdout(): boolean {
  return process.env.NODE_ENV !== "production";
}

function logEmailChangeCodeToStdout(email: string, code: string): void {
  console.log(
    `\n[alliance-hq] Account email change code for ${email} (dev only):\n${code}\n`,
  );
}

async function sendEmailChangeCodeViaResend(input: {
  to: string;
  code: string;
  hqUserId: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured.");
  }

  const from = resolveEmailFromAddress();
  const email = buildAuthCodeEmail(
    "emailChange",
    input.code,
    await resolveRecipientLocale({
      hqUserId: input.hqUserId,
      fallback: await requestLocaleFallback(),
    }),
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

export async function loadHqUserEmailById(
  hqUserId: string,
): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ email: schema.hqUsers.email })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, hqUserId))
    .limit(1);
  return row?.email ?? null;
}

export async function isHqUserEmailTakenByOther(input: {
  email: string;
  excludeHqUserId: string;
}): Promise<boolean> {
  const normalized = normalizeAshedEmail(input.email);
  if (!normalized) {
    return false;
  }

  const db = getDb();
  const [row] = await db
    .select({ id: schema.hqUsers.id })
    .from(schema.hqUsers)
    .where(
      and(
        eq(schema.hqUsers.email, normalized),
        ne(schema.hqUsers.id, input.excludeHqUserId),
      ),
    )
    .limit(1);

  return Boolean(row);
}

export async function requestHqEmailChange(input: {
  hqUserId: string;
  currentEmail: string;
  newEmailRaw: string;
}): Promise<void> {
  const newEmail = normalizeAshedEmail(input.newEmailRaw);
  if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
    throw new ChangeHqEmailError("Invalid email.", "invalid_email");
  }

  const currentNormalized = normalizeAshedEmail(input.currentEmail);
  if (currentNormalized === newEmail) {
    throw new ChangeHqEmailError(
      "That is already your account email.",
      "same_email",
    );
  }

  if (
    await isHqUserEmailTakenByOther({
      email: newEmail,
      excludeHqUserId: input.hqUserId,
    })
  ) {
    throw new ChangeHqEmailError(
      "That email is already used by another account.",
      "email_in_use",
    );
  }

  const db = getDb();
  const now = new Date();

  if (
    process.env.E2E_TEST === "true" &&
    newEmail.endsWith("@alliance-hq.test")
  ) {
    const e2eCode = process.env.E2E_EMAIL_CODE?.trim() ?? "";
    if (!/^[0-9]{6}$/.test(e2eCode)) {
      throw new ChangeHqEmailError(
        "E2E email verification is misconfigured.",
        "send_failed",
      );
    }
    await db
      .delete(schema.hqEmailChangePending)
      .where(eq(schema.hqEmailChangePending.hqUserId, input.hqUserId));
    await db.insert(schema.hqEmailChangePending).values({
      id: nanoid(16),
      hqUserId: input.hqUserId,
      newEmail,
      codeHash: hashEmailChangeCode({
        hqUserId: input.hqUserId,
        newEmail,
        code: e2eCode,
      }),
      failedAttempts: 0,
      expiresAt: new Date(now.getTime() + AUTH_EMAIL_CODE_TTL_MS),
      createdAt: now,
    });
    return;
  }

  const rateLimitCutoff = new Date(now.getTime() - AUTH_EMAIL_CODE_RATE_LIMIT_MS);
  const [recent] = await db
    .select({ id: schema.hqEmailChangePending.id })
    .from(schema.hqEmailChangePending)
    .where(
      and(
        eq(schema.hqEmailChangePending.hqUserId, input.hqUserId),
        gt(schema.hqEmailChangePending.createdAt, rateLimitCutoff),
      ),
    )
    .orderBy(desc(schema.hqEmailChangePending.createdAt))
    .limit(1);

  if (recent) {
    throw new ChangeHqEmailError(
      "Please wait before requesting another code.",
      "rate_limited",
    );
  }

  await db
    .delete(schema.hqEmailChangePending)
    .where(eq(schema.hqEmailChangePending.hqUserId, input.hqUserId));

  const code = generateAuthEmailCode();
  await db.insert(schema.hqEmailChangePending).values({
    id: nanoid(16),
    hqUserId: input.hqUserId,
    newEmail,
    codeHash: hashEmailChangeCode({
      hqUserId: input.hqUserId,
      newEmail,
      code,
    }),
    failedAttempts: 0,
    expiresAt: new Date(now.getTime() + AUTH_EMAIL_CODE_TTL_MS),
    createdAt: now,
  });

  const devLog = shouldLogEmailChangeCodeToStdout();
  if (devLog) {
    logEmailChangeCodeToStdout(newEmail, code);
    const flag = process.env.AUTH_EMAIL_CODE_LOG_ONLY?.trim().toLowerCase();
    if (flag === "1" || flag === "true" || flag === "yes") {
      return;
    }
  }

  try {
    await sendEmailChangeCodeViaResend({
      to: newEmail,
      code,
      hqUserId: input.hqUserId,
    });
  } catch (error) {
    if (devLog) {
      console.warn(
        "[alliance-hq] Resend send failed in dev; use the code printed above.",
        error instanceof Error ? error.message : error,
      );
      return;
    }
    throw new ChangeHqEmailError(
      "Failed to send verification code.",
      "send_failed",
    );
  }
}

export async function confirmHqEmailChange(input: {
  hqUserId: string;
  currentEmail: string;
  newEmailRaw: string;
  codeRaw: string;
  sessionId?: string | null;
}): Promise<{ email: string }> {
  const newEmail = normalizeAshedEmail(input.newEmailRaw);
  const code = input.codeRaw.trim();
  if (!newEmail || !/^[0-9]{6}$/.test(code)) {
    throw new ChangeHqEmailError("Invalid verification code.", "invalid_code");
  }

  if (
    await isHqUserEmailTakenByOther({
      email: newEmail,
      excludeHqUserId: input.hqUserId,
    })
  ) {
    throw new ChangeHqEmailError(
      "That email is already used by another account.",
      "email_in_use",
    );
  }

  const db = getDb();
  const now = new Date();
  const [record] = await db
    .select()
    .from(schema.hqEmailChangePending)
    .where(
      and(
        eq(schema.hqEmailChangePending.hqUserId, input.hqUserId),
        eq(schema.hqEmailChangePending.newEmail, newEmail),
        gt(schema.hqEmailChangePending.expiresAt, now),
      ),
    )
    .orderBy(desc(schema.hqEmailChangePending.createdAt))
    .limit(1);

  if (!record) {
    throw new ChangeHqEmailError(
      "Verification code expired or not found.",
      "not_found",
    );
  }

  const expectedHash = hashEmailChangeCode({
    hqUserId: input.hqUserId,
    newEmail,
    code,
  });

  if (record.codeHash !== expectedHash) {
    const nextAttempts = record.failedAttempts + 1;
    if (nextAttempts >= AUTH_EMAIL_CODE_MAX_VERIFY_ATTEMPTS) {
      await db
        .delete(schema.hqEmailChangePending)
        .where(eq(schema.hqEmailChangePending.id, record.id));
    } else {
      await db
        .update(schema.hqEmailChangePending)
        .set({ failedAttempts: nextAttempts })
        .where(eq(schema.hqEmailChangePending.id, record.id));
    }
    throw new ChangeHqEmailError("Invalid verification code.", "invalid_code");
  }

  await db
    .delete(schema.hqEmailChangePending)
    .where(eq(schema.hqEmailChangePending.hqUserId, input.hqUserId));

  const previousEmail = normalizeAshedEmail(input.currentEmail);
  await db
    .update(schema.hqUsers)
    .set({
      email: newEmail,
      emailVerifiedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.hqUsers.id, input.hqUserId));

  if (input.sessionId) {
    await writeAuditLog({
      sessionId: input.sessionId,
      allianceId: null,
      hqUserId: input.hqUserId,
      action: "hq.email_change",
      resourceType: "hq_user",
      resourceId: input.hqUserId,
      metadata: {
        previousEmail: previousEmail ?? null,
        newEmail,
      },
    });
  }

  return { email: newEmail };
}
