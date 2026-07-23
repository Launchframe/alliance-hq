import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  compareDepositSlipOcrQuality,
  isDepositSlipFingerprintShadowComparison,
  type DepositSlipCompareRow,
  type DepositSlipFingerprintShadowComparison,
} from "@/lib/banks/deposit-slip-ocr/compare-deposit-slip-ocr-quality.shared";
import { persistDepositSlipOcrEvalSnapshot } from "@/lib/banks/deposit-slip-ocr/deposit-slip-ocr-eval-snapshots.server";
import { DEPOSIT_SLIP_FINGERPRINT_SHADOW_PASS_ROLE } from "@/lib/video/enqueue-deposit-slip-fingerprint-shadow-pass";
import {
  mergeGroupComparisons,
  parseGroupComparisons,
} from "@/lib/video/group-comparisons.shared";

type ParsedRowLike = {
  ocrName: string | null;
  score: string | null;
  powerLevel: string | null;
  memberLevel: number | null;
  profession: string | null;
  deleted: number | null;
};

function toCompareRow(row: ParsedRowLike): DepositSlipCompareRow {
  const amountRaw = row.score?.trim();
  const amount = amountRaw ? Number(amountRaw) : null;
  return {
    commanderName: row.ocrName?.trim() ?? "",
    depositAt: row.powerLevel?.trim() || null,
    termDays: row.memberLevel ?? null,
    amount: amount != null && Number.isFinite(amount) ? Math.trunc(amount) : null,
    status: row.profession ?? null,
  };
}

type DedupeReportLike = { rawLineCount?: unknown; uniqueLineCount?: unknown };

function isDedupeReportLike(value: unknown): value is DedupeReportLike {
  return !!value && typeof value === "object";
}

/**
 * Compares the deposit-slip row-fingerprint shadow pass against the
 * *submitted* primary job for the same upload group, and persists the result
 * — both as an `ocr_eval_snapshots` row (for the daily/aggregate dashboard)
 * and merged onto `video_upload_groups.comparison_json` (for a quick
 * per-upload look, same pattern as `roster_tesseract_eval`).
 *
 * Ordering-agnostic by design: the shadow OCR pass and the officer's review
 * + submit can finish in either order. Call this from both
 * `process-deposit-slip-fingerprint-shadow-job.ts` (in case the primary was
 * already submitted before the shadow pass finished) and the submit route
 * (in case the shadow pass already finished before the officer submitted).
 * Whichever call observes *both* sides ready does the work; the other is a
 * cheap no-op. An atomic `comparisonJson` claim (UPDATE … WHERE the fingerprint
 * key is still null) keeps a near-simultaneous race from writing duplicate
 * `ocr_eval_snapshots` rows — only the winner persists the snapshot.
 */
export async function maybeCompareDepositSlipFingerprintShadow(params: {
  groupId: string;
}): Promise<void> {
  const db = getDb();

  const [group] = await db
    .select({
      primaryJobId: schema.videoUploadGroups.primaryJobId,
      boardKey: schema.videoUploadGroups.boardKey,
      hqEventId: schema.videoUploadGroups.hqEventId,
      comparisonJson: schema.videoUploadGroups.comparisonJson,
    })
    .from(schema.videoUploadGroups)
    .where(eq(schema.videoUploadGroups.id, params.groupId))
    .limit(1);

  if (!group?.primaryJobId) return;

  if (
    isDepositSlipFingerprintShadowComparison(
      parseGroupComparisons(group.comparisonJson).deposit_slip_fingerprint_shadow,
    )
  ) {
    return;
  }

  const [primaryJob] = await db
    .select({ parseSessionId: schema.videoJobs.parseSessionId })
    .from(schema.videoJobs)
    .where(eq(schema.videoJobs.id, group.primaryJobId))
    .limit(1);

  if (!primaryJob?.parseSessionId) return;

  const [primaryParseSession] = await db
    .select({ status: schema.parseSessions.status })
    .from(schema.parseSessions)
    .where(eq(schema.parseSessions.id, primaryJob.parseSessionId))
    .limit(1);

  // "Submitted" is the officer-reviewed ground truth — see module doc and
  // compare-deposit-slip-ocr-quality.shared.ts. Not ready yet is normal, not
  // an error: most calls here are the "other side isn't done yet" no-op.
  if (primaryParseSession?.status !== "submitted") return;

  const [shadowJob] = await db
    .select({
      id: schema.videoJobs.id,
      status: schema.videoJobs.status,
      parseSessionId: schema.videoJobs.parseSessionId,
      timingsJson: schema.videoJobs.timingsJson,
    })
    .from(schema.videoJobs)
    .where(
      and(
        eq(schema.videoJobs.groupId, params.groupId),
        eq(schema.videoJobs.passRole, DEPOSIT_SLIP_FINGERPRINT_SHADOW_PASS_ROLE),
      ),
    )
    .limit(1);

  if (!shadowJob || shadowJob.status !== "complete" || !shadowJob.parseSessionId) {
    return;
  }

  const [shadowParseSession] = await db
    .select({ dedupeReportJson: schema.parseSessions.dedupeReportJson })
    .from(schema.parseSessions)
    .where(eq(schema.parseSessions.id, shadowJob.parseSessionId))
    .limit(1);

  const shadowLineStats = isDedupeReportLike(shadowParseSession?.dedupeReportJson)
    ? shadowParseSession.dedupeReportJson
    : null;
  const rawLineCount =
    typeof shadowLineStats?.rawLineCount === "number"
      ? shadowLineStats.rawLineCount
      : null;
  const uniqueLineCount =
    typeof shadowLineStats?.uniqueLineCount === "number"
      ? shadowLineStats.uniqueLineCount
      : null;

  const shadowTotalMs =
    shadowJob.timingsJson &&
    typeof shadowJob.timingsJson === "object" &&
    "totalMs" in shadowJob.timingsJson &&
    typeof (shadowJob.timingsJson as { totalMs?: unknown }).totalMs === "number"
      ? (shadowJob.timingsJson as { totalMs: number }).totalMs
      : null;

  const [primaryRows, shadowRows] = await Promise.all([
    db
      .select({
        ocrName: schema.parsedRows.ocrName,
        score: schema.parsedRows.score,
        powerLevel: schema.parsedRows.powerLevel,
        memberLevel: schema.parsedRows.memberLevel,
        profession: schema.parsedRows.profession,
        deleted: schema.parsedRows.deleted,
      })
      .from(schema.parsedRows)
      .where(eq(schema.parsedRows.parseSessionId, primaryJob.parseSessionId)),
    db
      .select({
        ocrName: schema.parsedRows.ocrName,
        score: schema.parsedRows.score,
        powerLevel: schema.parsedRows.powerLevel,
        memberLevel: schema.parsedRows.memberLevel,
        profession: schema.parsedRows.profession,
        deleted: schema.parsedRows.deleted,
      })
      .from(schema.parsedRows)
      .where(eq(schema.parsedRows.parseSessionId, shadowJob.parseSessionId)),
  ]);

  const primaryCompare = primaryRows.filter((r) => !r.deleted).map(toCompareRow);
  const shadowCompare = shadowRows.filter((r) => !r.deleted).map(toCompareRow);

  const metrics = compareDepositSlipOcrQuality(primaryCompare, shadowCompare);

  const comparison: DepositSlipFingerprintShadowComparison = {
    kind: "deposit_slip_fingerprint_shadow",
    computedAt: new Date().toISOString(),
    primaryJobId: group.primaryJobId,
    shadowJobId: shadowJob.id,
    metrics,
    shadowTotalMs,
    rawLineCount,
    uniqueLineCount,
  };

  // Claim the comparison slot first so a near-simultaneous submit + shadow-
  // complete race cannot both insert ocr_eval_snapshots rows. The early
  // comparisonJson read above is a fast-path; this WHERE is the real guard.
  const [claimed] = await db
    .update(schema.videoUploadGroups)
    .set({
      comparisonJson: mergeGroupComparisons(group.comparisonJson, {
        deposit_slip_fingerprint_shadow: comparison,
      }),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.videoUploadGroups.id, params.groupId),
        sql`${schema.videoUploadGroups.comparisonJson}->'deposit_slip_fingerprint_shadow' IS NULL`,
      ),
    )
    .returning({ id: schema.videoUploadGroups.id });

  if (!claimed) {
    return;
  }

  await persistDepositSlipOcrEvalSnapshot({
    groupId: params.groupId,
    primaryJobId: group.primaryJobId,
    shadowJobId: shadowJob.id,
    boardKey: group.boardKey,
    hqEventId: group.hqEventId,
    metrics,
    shadowTotalMs,
    rawLineCount,
    uniqueLineCount,
  });
}
