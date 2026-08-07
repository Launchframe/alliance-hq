import { depositSlipScoreDefaultedRowIds } from "@/lib/banks/deposit-slip-score-default.shared";
import type { DedupeReport } from "@/lib/video/dedupe/merge-report.shared";
import { validateDepositSlipReviewRows } from "@/lib/banks/deposit-slip-review-validation.shared";
import type { DepositSlipReviewValidationRow } from "@/lib/banks/deposit-slip-review-validation.shared";
import { isRosterRowNameMismatch } from "@/lib/video/roster-video-review.shared";

export type ScoreReviewProblemRow = {
  id: string;
  memberId: string | null;
  score: string | null;
  scoreConflict?: boolean | number;
};

export function parseReviewScoreNumber(
  score: string | null | undefined,
): number | null {
  const scoreNum = Number.parseFloat(String(score ?? "").replace(/,/g, ""));
  return Number.isNaN(scoreNum) ? null : scoreNum;
}

export function isScoreReviewProblemRow(
  row: ScoreReviewProblemRow,
  options: {
    duplicateRowIds: ReadonlySet<string>;
    zeroScoreWarningDisabled: boolean;
  },
): boolean {
  if (!row.memberId) return true;
  if (options.duplicateRowIds.has(row.id)) return true;
  if (row.scoreConflict) return true;
  const scoreNum = parseReviewScoreNumber(row.score);
  if (scoreNum != null && scoreNum < 0) return true;
  if (scoreNum === 0 && !options.zeroScoreWarningDisabled) return true;
  return false;
}

export function buildScoreReviewProblemRowIds(
  visibleRowIds: readonly string[],
  rowsById: ReadonlyMap<string, ScoreReviewProblemRow>,
  options: {
    duplicateRowIds: ReadonlySet<string>;
    zeroScoreWarningDisabled: boolean;
  },
): string[] {
  const problems = new Set<string>();
  for (const row of rowsById.values()) {
    if (isScoreReviewProblemRow(row, options)) {
      problems.add(row.id);
    }
  }
  return visibleRowIds.filter((id) => problems.has(id));
}

export function findDuplicateOcrNameRowIds(
  rows: ReadonlyArray<{ id: string; ocrName: string; deleted: number }>,
): Set<string> {
  const byName = new Map<string, string[]>();
  for (const row of rows) {
    if (row.deleted === 1) continue;
    const key = row.ocrName.trim().toLowerCase();
    const list = byName.get(key) ?? [];
    list.push(row.id);
    byName.set(key, list);
  }
  const dupes = new Set<string>();
  for (const ids of byName.values()) {
    if (ids.length > 1) {
      for (const id of ids) dupes.add(id);
    }
  }
  return dupes;
}

export function computeRosterDedupeFlaggedRowIds(
  rows: ReadonlyArray<{
    id: string;
    dedupeClusterId?: string | null;
    deleted: number;
  }>,
): Set<string> {
  const byCluster = new Map<string, string[]>();
  for (const row of rows) {
    if (row.deleted === 1) continue;
    const clusterId = row.dedupeClusterId;
    if (!clusterId) continue;
    const bucket = byCluster.get(clusterId) ?? [];
    bucket.push(row.id);
    byCluster.set(clusterId, bucket);
  }
  const flagged = new Set<string>();
  for (const ids of byCluster.values()) {
    if (ids.length >= 2) {
      for (const id of ids) flagged.add(id);
    }
  }
  return flagged;
}

export function buildRosterReviewProblemRowIds(
  visibleRowIds: readonly string[],
  rows: ReadonlyArray<{
    id: string;
    ocrName: string;
    allianceRank: number | null;
    memberId: string | null;
    memberName: string | null;
    matchConfidence: number | null;
    matchMethod?: string | null;
    dedupeClusterId?: string | null;
    deleted: number;
  }>,
  options: {
    duplicateRowIds: ReadonlySet<string>;
    unmatchedRowIds: ReadonlySet<string>;
    existingMemberCount?: number;
  },
): string[] {
  const activeRows = rows.filter((row) => row.deleted !== 1);
  const duplicateOcrNameRowIds = findDuplicateOcrNameRowIds(activeRows);
  const flaggedRowIds = computeRosterDedupeFlaggedRowIds(activeRows);
  const problems = new Set<string>();

  for (const row of activeRows) {
    if (options.duplicateRowIds.has(row.id)) problems.add(row.id);
    if (duplicateOcrNameRowIds.has(row.id)) problems.add(row.id);
    if (options.unmatchedRowIds.has(row.id)) problems.add(row.id);
    if (flaggedRowIds.has(row.id)) problems.add(row.id);
    if (
      row.allianceRank == null ||
      row.allianceRank < 1 ||
      row.allianceRank > 5
    ) {
      problems.add(row.id);
    }
    if (
      isRosterRowNameMismatch(row, {
        existingMemberCount: options.existingMemberCount,
      })
    ) {
      problems.add(row.id);
    }
  }

  return visibleRowIds.filter((id) => problems.has(id));
}

export function buildDepositSlipReviewProblemRowIds(
  visibleRowIds: readonly string[],
  rows: readonly DepositSlipReviewValidationRow[],
  dedupeReport: DedupeReport | null | undefined,
): string[] {
  const validation = validateDepositSlipReviewRows(rows, dedupeReport ?? null);
  const problems = new Set<string>();

  for (const id of validation.incompleteRowIds) problems.add(id);
  for (const id of validation.duplicateRowIds) problems.add(id);
  for (const row of rows) {
    const clusterId = row.dedupeClusterId;
    if (
      clusterId &&
      validation.unresolvedClusterIds.has(clusterId)
    ) {
      problems.add(row.id);
    }
  }
  for (const id of depositSlipScoreDefaultedRowIds(
    rows.map((row) => ({
      id: row.id,
      score: row.score ?? null,
      deleted: row.deleted,
      scoreDefaulted: (row as { scoreDefaulted?: boolean }).scoreDefaulted,
    })),
  )) {
    problems.add(id);
  }
  for (const row of rows) {
    const interpolated = (row as { depositAtInterpolated?: boolean | null })
      .depositAtInterpolated;
    if (interpolated) problems.add(row.id);
  }

  return visibleRowIds.filter((id) => problems.has(id));
}

export function scrollToReviewRow(rowId: string): void {
  const escaped =
    typeof CSS !== "undefined" && "escape" in CSS
      ? CSS.escape(rowId)
      : rowId.replace(/"/g, '\\"');
  document
    .querySelector(
      `[data-review-row-id="${escaped}"], [data-deposit-slip-row-id="${escaped}"]`,
    )
    ?.scrollIntoView({ behavior: "smooth", block: "center" });
}
