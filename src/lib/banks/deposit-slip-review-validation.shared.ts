import type { DedupeReport } from "@/lib/video/dedupe/merge-report.shared";

export type DepositSlipReviewValidationRow = {
  id: string;
  ocrName: string;
  score: string | null | undefined;
  powerLevel: string | null | undefined;
  memberLevel: number | null | undefined;
  dedupeClusterId?: string | null;
  profession?: string | null;
  allianceRankTitle?: string | null;
  rosterRankRaw?: string | null;
  frameIndex?: number | null;
  deleted: number | boolean;
};

export type DepositSlipReviewSubmittedRow = {
  id: string;
  ocrName?: string | null;
  memberName?: string | null;
  score?: string | null;
  powerLevel?: string | null;
  memberLevel?: number | null;
  profession?: string | null;
  allianceRankTitle?: string | null;
  rosterRankRaw?: string | null;
  frameIndex?: number | null;
  deleted?: number | boolean | null;
};

function isDeleted(row: DepositSlipReviewValidationRow): boolean {
  return row.deleted === true || row.deleted === 1;
}

export function mergeDepositSlipReviewRowsForSubmit<
  TRow extends DepositSlipReviewValidationRow,
  TSubmitted extends DepositSlipReviewSubmittedRow,
>(
  persistedRows: readonly TRow[],
  submittedRows: readonly TSubmitted[],
): {
  rows: TRow[];
  unknownRowIds: Set<string>;
  duplicateRowIds: Set<string>;
} {
  const persistedById = new Map(persistedRows.map((row) => [row.id, row]));
  const submittedById = new Map<string, TSubmitted>();
  const unknownRowIds = new Set<string>();
  const duplicateRowIds = new Set<string>();

  for (const row of submittedRows) {
    if (!persistedById.has(row.id)) {
      unknownRowIds.add(row.id);
      continue;
    }
    if (submittedById.has(row.id)) {
      duplicateRowIds.add(row.id);
      continue;
    }
    submittedById.set(row.id, row);
  }

  const rows = persistedRows.map((persisted) => {
    const submitted = submittedById.get(persisted.id);
    if (!submitted) return persisted;

    return {
      ...persisted,
      ocrName:
        submitted.ocrName != null
          ? submitted.ocrName
          : submitted.memberName != null
            ? submitted.memberName
            : persisted.ocrName,
      score: "score" in submitted ? submitted.score : persisted.score,
      powerLevel:
        "powerLevel" in submitted ? submitted.powerLevel : persisted.powerLevel,
      memberLevel:
        "memberLevel" in submitted
          ? submitted.memberLevel
          : persisted.memberLevel,
      profession:
        "profession" in submitted ? submitted.profession : persisted.profession,
      allianceRankTitle:
        "allianceRankTitle" in submitted
          ? submitted.allianceRankTitle
          : persisted.allianceRankTitle,
      rosterRankRaw:
        "rosterRankRaw" in submitted
          ? submitted.rosterRankRaw
          : persisted.rosterRankRaw,
      frameIndex:
        "frameIndex" in submitted ? submitted.frameIndex : persisted.frameIndex,
      deleted:
        "deleted" in submitted ? Boolean(submitted.deleted) : persisted.deleted,
    };
  });

  return { rows, unknownRowIds, duplicateRowIds };
}

export const DEPOSIT_SLIP_REQUIRED_FIELD_KEYS = [
  "ocrName",
  "score",
  "memberLevel",
  "powerLevel",
] as const;

export type DepositSlipRequiredFieldKey =
  (typeof DEPOSIT_SLIP_REQUIRED_FIELD_KEYS)[number];

/** Which required fields on a single row are missing/invalid, if any. */
export function incompleteDepositSlipReviewRowFieldKeys(
  row: DepositSlipReviewValidationRow,
): Set<DepositSlipRequiredFieldKey> {
  const missing = new Set<DepositSlipRequiredFieldKey>();
  if (!row.ocrName.trim()) missing.add("ocrName");
  const amount = row.score?.trim() ? Number(row.score) : NaN;
  if (!Number.isFinite(amount) || amount <= 0) missing.add("score");
  if (row.memberLevel == null) missing.add("memberLevel");
  if (!row.powerLevel) missing.add("powerLevel");
  return missing;
}

/** Per-row missing/invalid required field keys, keyed by row id (deleted rows excluded). */
export function incompleteDepositSlipReviewRowFieldsById(
  rows: readonly DepositSlipReviewValidationRow[],
): Map<string, Set<DepositSlipRequiredFieldKey>> {
  const map = new Map<string, Set<DepositSlipRequiredFieldKey>>();
  for (const row of rows) {
    if (isDeleted(row)) continue;
    const missing = incompleteDepositSlipReviewRowFieldKeys(row);
    if (missing.size > 0) map.set(row.id, missing);
  }
  return map;
}

export function incompleteDepositSlipReviewRowIds(
  rows: readonly DepositSlipReviewValidationRow[],
): Set<string> {
  return new Set(incompleteDepositSlipReviewRowFieldsById(rows).keys());
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
  const incompleteFieldsByRowId = incompleteDepositSlipReviewRowFieldsById(rows);
  const incompleteRowIds = new Set(incompleteFieldsByRowId.keys());
  const unresolvedClusterIds = unresolvedDepositSlipFlaggedClusterIds(
    rows,
    report,
  );
  const activeRowCount = rows.filter((row) => !isDeleted(row)).length;
  const hasUnresolvedFlaggedClusters = unresolvedClusterIds.size > 0;

  return {
    incompleteRowIds,
    incompleteFieldsByRowId,
    unresolvedClusterIds,
    hasUnresolvedFlaggedClusters,
    canSubmitSlips:
      activeRowCount > 0 &&
      incompleteRowIds.size === 0 &&
      !hasUnresolvedFlaggedClusters,
  };
}
