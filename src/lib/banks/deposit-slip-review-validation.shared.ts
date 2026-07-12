import type { DedupeReport } from "@/lib/video/dedupe/merge-report.shared";

export type DepositSlipReviewValidationRow = {
  id: string;
  ocrName: string;
  score: string | null | undefined;
  powerLevel: string | null | undefined;
  memberLevel: number | null | undefined;
  dedupeClusterId?: string | null;
  deleted: number | boolean;
};

function isDeleted(row: DepositSlipReviewValidationRow): boolean {
  return row.deleted === true || row.deleted === 1;
}

export function incompleteDepositSlipReviewRowIds(
  rows: readonly DepositSlipReviewValidationRow[],
): Set<string> {
  return new Set(
    rows
      .filter((row) => !isDeleted(row))
      .filter((row) => {
        const amount = row.score?.trim() ? Number(row.score) : NaN;
        return (
          !row.ocrName.trim() ||
          !Number.isFinite(amount) ||
          amount <= 0 ||
          row.memberLevel == null ||
          !row.powerLevel
        );
      })
      .map((row) => row.id),
  );
}

export function unresolvedDepositSlipFlaggedClusterIds(
  rows: readonly DepositSlipReviewValidationRow[],
  report: DedupeReport | null,
): Set<string> {
  const flaggedIds = new Set(
    (report?.clusters ?? [])
      .filter((cluster) => cluster.disposition === "flagged")
      .map((cluster) => cluster.clusterId),
  );
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (isDeleted(row)) continue;
    const clusterId = row.dedupeClusterId;
    if (!clusterId || !flaggedIds.has(clusterId)) continue;
    counts.set(clusterId, (counts.get(clusterId) ?? 0) + 1);
  }

  const unresolved = new Set<string>();
  for (const [clusterId, count] of counts) {
    if (count >= 2) unresolved.add(clusterId);
  }
  return unresolved;
}

export function validateDepositSlipReviewRows(
  rows: readonly DepositSlipReviewValidationRow[],
  report: DedupeReport | null,
) {
  const incompleteRowIds = incompleteDepositSlipReviewRowIds(rows);
  const unresolvedClusterIds = unresolvedDepositSlipFlaggedClusterIds(
    rows,
    report,
  );
  const activeRowCount = rows.filter((row) => !isDeleted(row)).length;
  const hasUnresolvedFlaggedClusters = unresolvedClusterIds.size > 0;

  return {
    incompleteRowIds,
    unresolvedClusterIds,
    hasUnresolvedFlaggedClusters,
    canSubmitSlips:
      activeRowCount > 0 &&
      incompleteRowIds.size === 0 &&
      !hasUnresolvedFlaggedClusters,
  };
}
