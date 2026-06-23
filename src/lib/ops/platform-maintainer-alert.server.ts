import "server-only";

import { eq, gt, lt, sql } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  PRODUCTION_EMAIL_FROM,
  RESEND_DEV_EMAIL_FROM,
} from "@/lib/public-site";

function resolveEmailFromAddress(): string {
  return (
    process.env.EMAIL_FROM ??
    (process.env.NODE_ENV === "production"
      ? PRODUCTION_EMAIL_FROM
      : RESEND_DEV_EMAIL_FROM)
  );
}

export async function listPlatformMaintainerEmails(): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ email: schema.hqUsers.email })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.isPlatformMaintainer, 1));
  return rows.map((row) => row.email).filter(Boolean);
}

async function sendResendEmail(input: {
  to: string[];
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  if (input.to.length === 0) {
    return;
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.warn(
      "[alliance-hq] RESEND_API_KEY missing — maintainer alert not sent:",
      input.subject,
    );
    console.warn(input.text);
    return;
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
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });

  if (!res.ok) {
    throw new Error(
      `Resend maintainer alert failed: ${JSON.stringify(await res.json())}`,
    );
  }
}

/** Returns true when this fingerprint was newly recorded (first alert in window). */
export async function claimOpsAlertFingerprint(
  fingerprint: string,
): Promise<boolean> {
  const db = getDb();
  const now = new Date();
  const inserted = await db
    .insert(schema.authOpsAlertFingerprints)
    .values({
      fingerprint,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning({ fingerprint: schema.authOpsAlertFingerprints.fingerprint });

  return inserted.length > 0;
}

export async function releaseOpsAlertFingerprint(
  fingerprint: string,
): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.authOpsAlertFingerprints)
    .where(eq(schema.authOpsAlertFingerprints.fingerprint, fingerprint));
}

export async function emailPlatformMaintainers(input: {
  subject: string;
  text: string;
  html: string;
  /** When set, only send once per unique fingerprint (dedup). */
  dedupeFingerprint?: string;
}): Promise<{ sent: boolean; recipientCount: number }> {
  if (process.env.E2E_TEST === "true") {
    console.warn(
      "[alliance-hq] E2E_TEST — skipping maintainer email:",
      input.subject,
    );
    return { sent: false, recipientCount: 0 };
  }

  if (input.dedupeFingerprint) {
    const claimed = await claimOpsAlertFingerprint(input.dedupeFingerprint);
    if (!claimed) {
      return { sent: false, recipientCount: 0 };
    }
  }

  const recipients = await listPlatformMaintainerEmails();
  if (recipients.length === 0) {
    if (input.dedupeFingerprint) {
      await releaseOpsAlertFingerprint(input.dedupeFingerprint);
    }
    console.warn(
      "[alliance-hq] No platform maintainer emails — alert not sent:",
      input.subject,
    );
    console.warn(input.text);
    return { sent: false, recipientCount: 0 };
  }

  try {
    await sendResendEmail({
      to: recipients,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    return { sent: true, recipientCount: recipients.length };
  } catch (error) {
    if (input.dedupeFingerprint) {
      await releaseOpsAlertFingerprint(input.dedupeFingerprint);
    }
    console.error("[alliance-hq] Maintainer alert email failed:", error);
    return { sent: false, recipientCount: recipients.length };
  }
}

/** Best-effort prune so attempt counts stay cheap; not required for correctness. */
export async function pruneOldSendCodeAttempts(
  olderThanMs = 24 * 60 * 60 * 1000,
): Promise<void> {
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanMs);
  await db
    .delete(schema.authSendCodeAttempts)
    .where(lt(schema.authSendCodeAttempts.createdAt, cutoff));
}

export async function countSendCodeAttemptsSince(since: Date): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.authSendCodeAttempts)
    .where(gt(schema.authSendCodeAttempts.createdAt, since));
  return row?.count ?? 0;
}
