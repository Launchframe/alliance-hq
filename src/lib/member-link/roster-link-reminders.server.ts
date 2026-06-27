import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { and, eq, isNull, lt } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import {
  claimOpsAlertFingerprint,
  releaseOpsAlertFingerprint,
} from "@/lib/ops/platform-maintainer-alert.server";

import { satisfyRosterLinkInboxItem } from "./roster-link-inbox.server";
import {
  resolveAllianceOwnerEmail,
  sendRosterLinkOwnerApprovalEmail,
} from "./roster-link-owner-email.server";

const REMINDER_WINDOWS_MS = [
  24 * 60 * 60 * 1000,
  72 * 60 * 60 * 1000,
] as const;

async function loadPendingRequestTokens(requestId: string): Promise<{
  acceptToken: string;
  rejectToken: string;
} | null> {
  const db = getDb();
  const now = new Date();
  const rows = await db
    .select()
    .from(schema.hqRosterLinkActionTokens)
    .where(
      and(
        eq(schema.hqRosterLinkActionTokens.requestId, requestId),
        isNull(schema.hqRosterLinkActionTokens.usedAt),
      ),
    );

  const acceptRow = rows.find((row) => row.action === "accept");
  const rejectRow = rows.find((row) => row.action === "reject");
  if (!acceptRow || !rejectRow) return null;
  if (acceptRow.expiresAt < now || rejectRow.expiresAt < now) return null;

  // Tokens are stored hashed — reminders cannot resend original links without
  // persisting raw tokens. Re-issue fresh action tokens for reminder emails.
  const hash = (token: string) =>
    createHash("sha256").update(token).digest("hex");
  const makeToken = () => randomBytes(32).toString("base64url");
  const acceptToken = makeToken();
  const rejectToken = makeToken();
  const expiresAt = acceptRow.expiresAt;

  await db
    .update(schema.hqRosterLinkActionTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(schema.hqRosterLinkActionTokens.requestId, requestId),
        isNull(schema.hqRosterLinkActionTokens.usedAt),
      ),
    );

  await db.insert(schema.hqRosterLinkActionTokens).values([
    {
      id: nanoid(),
      requestId,
      action: "accept",
      tokenHash: hash(acceptToken),
      expiresAt,
    },
    {
      id: nanoid(),
      requestId,
      action: "reject",
      tokenHash: hash(rejectToken),
      expiresAt,
    },
  ]);

  return { acceptToken, rejectToken };
}

export async function runRosterLinkReminderPass(
  now = new Date(),
): Promise<number> {
  const db = getDb();
  const pending = await db
    .select()
    .from(schema.hqRosterLinkRequests)
    .where(eq(schema.hqRosterLinkRequests.status, "pending"));

  let sent = 0;

  for (const request of pending) {
    const ageMs = now.getTime() - request.createdAt.getTime();
    const window = REMINDER_WINDOWS_MS.find(
      (ms) => ageMs >= ms && ageMs < ms + 60 * 60 * 1000,
    );
    if (!window) continue;

    const ownerEmail = await resolveAllianceOwnerEmail(request.allianceId);
    if (!ownerEmail) continue;

    const tokens = await loadPendingRequestTokens(request.id);
    if (!tokens) continue;

    const fingerprint = `roster-link-reminder:${request.id}:${window}`;
    const claimed = await claimOpsAlertFingerprint(fingerprint);
    if (!claimed) continue;

    const [alliance] = await db
      .select({ tag: schema.alliances.tag })
      .from(schema.alliances)
      .where(eq(schema.alliances.id, request.allianceId))
      .limit(1);

    try {
      await sendRosterLinkOwnerApprovalEmail({
        allianceId: request.allianceId,
        allianceTag: alliance?.tag ?? "alliance",
        requestId: request.id,
        gameUserName: request.gameUserName,
        reportedName: request.reportedName,
        gameUid: request.gameUid,
        gameServerNumber: request.gameServerNumber,
        acceptToken: tokens.acceptToken,
        rejectToken: tokens.rejectToken,
        isReminder: true,
      });
      sent += 1;
    } catch (error) {
      console.error("[roster-link] reminder email failed", error);
      await releaseOpsAlertFingerprint(fingerprint);
    }
  }

  // Expire stale pending requests after token TTL (7 days)
  const staleBefore = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const superseded = await db
    .update(schema.hqRosterLinkRequests)
    .set({ status: "superseded", updatedAt: now })
    .where(
      and(
        eq(schema.hqRosterLinkRequests.status, "pending"),
        lt(schema.hqRosterLinkRequests.createdAt, staleBefore),
      ),
    )
    .returning({ id: schema.hqRosterLinkRequests.id });

  for (const row of superseded) {
    await satisfyRosterLinkInboxItem(row.id);
  }

  return sent;
}
