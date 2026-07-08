import "server-only";

import { createHash } from "node:crypto";

import { and, desc, eq, gt } from "drizzle-orm";
import { nanoid } from "nanoid";

import { normalizeAshedEmail } from "@/lib/alliance/accessible";
import {
  AUTH_EMAIL_CODE_MAX_VERIFY_ATTEMPTS,
  AUTH_EMAIL_CODE_RATE_LIMIT_MS,
  AUTH_EMAIL_CODE_TTL_MS,
  generateAuthEmailCode,
} from "@/lib/auth/email-code.server";
import {
  assessMergeHqUsers,
  loadHqUserIdByEmail,
  MergeHqUsersError,
  mergeHqUsersIntoCanonical,
  type MergeHqUsersPreview,
} from "@/lib/auth/merge-hq-users.server";
import { getDb, schema } from "@/lib/db";
import {
  PRODUCTION_EMAIL_FROM,
  RESEND_DEV_EMAIL_FROM,
} from "@/lib/public-site";

export class AccountMergeProofError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid_email"
      | "source_not_found"
      | "same_account"
      | "rate_limited"
      | "send_failed"
      | "invalid_code"
      | "not_found"
      | "proof_expired"
      | "proof_required"
      | MergeHqUsersError["code"],
  ) {
    super(message);
    this.name = "AccountMergeProofError";
  }
}

function hashMergeProofCode(input: {
  canonicalHqUserId: string;
  sourceHqUserId: string;
  code: string;
}): string {
  return createHash("sha256")
    .update(
      `${input.canonicalHqUserId}:${input.sourceHqUserId}:${input.code.trim()}`,
    )
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

function shouldLogMergeCodeToStdout(): boolean {
  return process.env.NODE_ENV !== "production";
}

function logMergeCodeToStdout(email: string, code: string): void {
  console.log(
    `\n[alliance-hq] Account merge proof code for ${email} (dev only):\n${code}\n`,
  );
}

function mergeProofCodeHtml(code: string): string {
  return `
<body style="background: #0d1117; margin: 0; padding: 24px;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0"
    style="max-width: 480px; margin: auto; font-family: Helvetica, Arial, sans-serif;">
    <tr>
      <td style="padding: 24px; background: #161b22; border: 1px solid #30363d; border-radius: 12px;">
        <p style="margin: 0 0 8px; font-size: 18px; font-weight: 600; color: #e6edf3;">
          Confirm account merge
        </p>
        <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.5; color: #8b949e;">
          Someone asked to move alliance access from this account into another Alliance HQ login. Enter this code only if you started that merge.
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

async function sendMergeProofCodeViaResend(input: {
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
      subject: `${input.code} is your Alliance HQ account merge code`,
      html: mergeProofCodeHtml(input.code),
      text: `Your Alliance HQ account merge code is ${input.code}. It expires in 10 minutes.`,
    }),
  });

  if (!res.ok) {
    throw new Error(`Resend error: ${JSON.stringify(await res.json())}`);
  }
}

function mapMergeError(error: unknown): never {
  if (error instanceof MergeHqUsersError) {
    throw new AccountMergeProofError(error.message, error.code);
  }
  throw error;
}

async function loadSourceUserByEmail(sourceEmailRaw: string) {
  const sourceEmail = normalizeAshedEmail(sourceEmailRaw);
  if (!sourceEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sourceEmail)) {
    throw new AccountMergeProofError("Invalid email.", "invalid_email");
  }

  const sourceHqUserId = await loadHqUserIdByEmail(sourceEmail);
  if (!sourceHqUserId) {
    throw new AccountMergeProofError(
      "No Alliance HQ account uses that email.",
      "source_not_found",
    );
  }

  const db = getDb();
  const [source] = await db
    .select({ id: schema.hqUsers.id, email: schema.hqUsers.email })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, sourceHqUserId))
    .limit(1);

  if (!source) {
    throw new AccountMergeProofError(
      "No Alliance HQ account uses that email.",
      "source_not_found",
    );
  }

  return source;
}

export async function requestAccountMergeSourceProof(input: {
  canonicalHqUserId: string;
  sourceEmailRaw: string;
}): Promise<void> {
  const source = await loadSourceUserByEmail(input.sourceEmailRaw);

  if (source.id === input.canonicalHqUserId) {
    throw new AccountMergeProofError("That is this account.", "same_account");
  }

  try {
    await assessMergeHqUsers({
      canonicalHqUserId: input.canonicalHqUserId,
      sourceHqUserId: source.id,
    });
  } catch (error) {
    mapMergeError(error);
  }

  const db = getDb();
  const now = new Date();

  if (
    process.env.E2E_TEST === "true" &&
    source.email.endsWith("@alliance-hq.test")
  ) {
    const e2eCode = process.env.E2E_EMAIL_CODE?.trim() ?? "";
    if (!/^[0-9]{6}$/.test(e2eCode)) {
      throw new AccountMergeProofError(
        "E2E email verification is misconfigured.",
        "send_failed",
      );
    }

    await db
      .delete(schema.hqAccountMergePending)
      .where(
        eq(schema.hqAccountMergePending.canonicalHqUserId, input.canonicalHqUserId),
      );

    await db.insert(schema.hqAccountMergePending).values({
      id: nanoid(16),
      canonicalHqUserId: input.canonicalHqUserId,
      sourceHqUserId: source.id,
      codeHash: hashMergeProofCode({
        canonicalHqUserId: input.canonicalHqUserId,
        sourceHqUserId: source.id,
        code: e2eCode,
      }),
      failedAttempts: 0,
      verifiedAt: null,
      expiresAt: new Date(now.getTime() + AUTH_EMAIL_CODE_TTL_MS),
      createdAt: now,
    });
    return;
  }

  const rateLimitCutoff = new Date(now.getTime() - AUTH_EMAIL_CODE_RATE_LIMIT_MS);
  const [recent] = await db
    .select({ id: schema.hqAccountMergePending.id })
    .from(schema.hqAccountMergePending)
    .where(
      and(
        eq(schema.hqAccountMergePending.canonicalHqUserId, input.canonicalHqUserId),
        gt(schema.hqAccountMergePending.createdAt, rateLimitCutoff),
      ),
    )
    .orderBy(desc(schema.hqAccountMergePending.createdAt))
    .limit(1);

  if (recent) {
    throw new AccountMergeProofError(
      "Please wait before requesting another code.",
      "rate_limited",
    );
  }

  await db
    .delete(schema.hqAccountMergePending)
    .where(
      eq(schema.hqAccountMergePending.canonicalHqUserId, input.canonicalHqUserId),
    );

  const code = generateAuthEmailCode();
  await db.insert(schema.hqAccountMergePending).values({
    id: nanoid(16),
    canonicalHqUserId: input.canonicalHqUserId,
    sourceHqUserId: source.id,
    codeHash: hashMergeProofCode({
      canonicalHqUserId: input.canonicalHqUserId,
      sourceHqUserId: source.id,
      code,
    }),
    failedAttempts: 0,
    verifiedAt: null,
    expiresAt: new Date(now.getTime() + AUTH_EMAIL_CODE_TTL_MS),
    createdAt: now,
  });

  const devLog = shouldLogMergeCodeToStdout();
  if (devLog) {
    logMergeCodeToStdout(source.email, code);
    const flag = process.env.AUTH_EMAIL_CODE_LOG_ONLY?.trim().toLowerCase();
    if (flag === "1" || flag === "true" || flag === "yes") {
      return;
    }
  }

  try {
    await sendMergeProofCodeViaResend({ to: source.email, code });
  } catch (error) {
    if (devLog) {
      console.warn(
        "[alliance-hq] Resend send failed in dev; use the code printed above.",
        error instanceof Error ? error.message : error,
      );
      return;
    }
    throw new AccountMergeProofError(
      "Failed to send verification code.",
      "send_failed",
    );
  }
}

async function verifyPendingMergeProof(input: {
  canonicalHqUserId: string;
  sourceEmailRaw: string;
  codeRaw: string;
  markVerified: boolean;
}): Promise<{ sourceHqUserId: string }> {
  const source = await loadSourceUserByEmail(input.sourceEmailRaw);
  const code = input.codeRaw.trim();
  if (!/^[0-9]{6}$/.test(code)) {
    throw new AccountMergeProofError("Invalid verification code.", "invalid_code");
  }

  const db = getDb();
  const now = new Date();
  const [record] = await db
    .select()
    .from(schema.hqAccountMergePending)
    .where(
      and(
        eq(schema.hqAccountMergePending.canonicalHqUserId, input.canonicalHqUserId),
        eq(schema.hqAccountMergePending.sourceHqUserId, source.id),
        gt(schema.hqAccountMergePending.expiresAt, now),
      ),
    )
    .orderBy(desc(schema.hqAccountMergePending.createdAt))
    .limit(1);

  if (!record) {
    throw new AccountMergeProofError(
      "Verification code expired or not found.",
      "not_found",
    );
  }

  const expectedHash = hashMergeProofCode({
    canonicalHqUserId: input.canonicalHqUserId,
    sourceHqUserId: source.id,
    code,
  });

  if (record.codeHash !== expectedHash) {
    const nextAttempts = record.failedAttempts + 1;
    if (nextAttempts >= AUTH_EMAIL_CODE_MAX_VERIFY_ATTEMPTS) {
      await db
        .delete(schema.hqAccountMergePending)
        .where(eq(schema.hqAccountMergePending.id, record.id));
    } else {
      await db
        .update(schema.hqAccountMergePending)
        .set({ failedAttempts: nextAttempts })
        .where(eq(schema.hqAccountMergePending.id, record.id));
    }
    throw new AccountMergeProofError("Invalid verification code.", "invalid_code");
  }

  if (input.markVerified) {
    await db
      .update(schema.hqAccountMergePending)
      .set({ verifiedAt: now })
      .where(eq(schema.hqAccountMergePending.id, record.id));
  }

  return { sourceHqUserId: source.id };
}

export async function previewAccountMerge(input: {
  canonicalHqUserId: string;
  sourceEmailRaw: string;
  codeRaw: string;
}): Promise<MergeHqUsersPreview> {
  const { sourceHqUserId } = await verifyPendingMergeProof({
    ...input,
    markVerified: true,
  });

  try {
    return await assessMergeHqUsers({
      canonicalHqUserId: input.canonicalHqUserId,
      sourceHqUserId,
    });
  } catch (error) {
    mapMergeError(error);
  }
}

export async function confirmAccountMerge(input: {
  canonicalHqUserId: string;
  sourceEmailRaw: string;
  codeRaw: string;
  sessionId?: string | null;
}) {
  const db = getDb();
  const now = new Date();
  const source = await loadSourceUserByEmail(input.sourceEmailRaw);

  const [record] = await db
    .select()
    .from(schema.hqAccountMergePending)
    .where(
      and(
        eq(schema.hqAccountMergePending.canonicalHqUserId, input.canonicalHqUserId),
        eq(schema.hqAccountMergePending.sourceHqUserId, source.id),
        gt(schema.hqAccountMergePending.expiresAt, now),
      ),
    )
    .orderBy(desc(schema.hqAccountMergePending.createdAt))
    .limit(1);

  if (!record?.verifiedAt) {
    await verifyPendingMergeProof({
      canonicalHqUserId: input.canonicalHqUserId,
      sourceEmailRaw: input.sourceEmailRaw,
      codeRaw: input.codeRaw,
      markVerified: true,
    });
  } else if (input.codeRaw.trim()) {
    await verifyPendingMergeProof({
      canonicalHqUserId: input.canonicalHqUserId,
      sourceEmailRaw: input.sourceEmailRaw,
      codeRaw: input.codeRaw,
      markVerified: false,
    });
  } else {
    throw new AccountMergeProofError(
      "Verification expired. Request a new code.",
      "proof_required",
    );
  }

  try {
    const result = await mergeHqUsersIntoCanonical({
      canonicalHqUserId: input.canonicalHqUserId,
      sourceHqUserId: source.id,
      sessionId: input.sessionId,
    });

    await db
      .delete(schema.hqAccountMergePending)
      .where(
        eq(schema.hqAccountMergePending.canonicalHqUserId, input.canonicalHqUserId),
      );

    return result;
  } catch (error) {
    mapMergeError(error);
  }
}
