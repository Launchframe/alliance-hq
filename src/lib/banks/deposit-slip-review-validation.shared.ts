import { DEPOSIT_TERMS, type DepositTermDays } from "@/lib/banks/types.shared";
import type { DedupeReport } from "@/lib/video/dedupe/merge-report.shared";
import type { DuplicateMemberIssue } from "@/lib/video/review-validation";

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
  memberId?: string | null;
  memberName?: string | null;
  matchConfidence?: number | null;
  matchMethod?: string | null;
  deleted: number | boolean;
};

export type DepositSlipReviewSubmittedRow = {
  id: string;
  ocrName?: string | null;
  memberId?: string | null;
  memberName?: string | null;
  matchConfidence?: number | null;
  matchMethod?: string | null;
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
      memberId: "memberId" in submitted ? submitted.memberId : persisted.memberId,
      memberName:
        "memberName" in submitted ? submitted.memberName : persisted.memberName,
      matchConfidence:
        "matchConfidence" in submitted
          ? submitted.matchConfidence
          : persisted.matchConfidence,
      matchMethod:
        "matchMethod" in submitted ? submitted.matchMethod : persisted.matchMethod,
      deleted:
        "deleted" in submitted ? Boolean(submitted.deleted) : persisted.deleted,
    };
  });

  return { rows, unknownRowIds, duplicateRowIds };
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

function normalizeCommanderIdentityKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

type LockedDepositWindow = { start: number; end: number };

/**
 * A locked slip's window is [depositAt, depositAt + termDays]. Two locked
 * windows for the same commander that overlap mean the commander had two
 * simultaneously-open deposits — an illegal in-game duplicate investment.
 *
 * Rows missing `powerLevel` (depositAt) or `memberLevel` (termDays), or with
 * a `memberLevel` outside {@link DEPOSIT_TERMS}, can't establish a window and
 * are excluded rather than risk a false positive — OCR sometimes defaults a
 * garbled matured/looted row to `status: "locked"` without a usable
 * timestamp/term (or an officer typo like term `2`), and that must not look
 * like a duplicate.
 */
function lockedWindowForRow(
  row: Pick<DepositSlipReviewValidationRow, "powerLevel" | "memberLevel">,
): LockedDepositWindow | null {
  if (!row.powerLevel) return null;
  const start = Date.parse(row.powerLevel);
  if (!Number.isFinite(start)) return null;
  if (row.memberLevel == null) return null;
  if (!(DEPOSIT_TERMS as readonly number[]).includes(row.memberLevel)) {
    return null;
  }
  const termDays = row.memberLevel as DepositTermDays;
  const end = start + termDays * 24 * 60 * 60 * 1000;
  return { start, end };
}

function lockedWindowsOverlap(
  a: LockedDepositWindow,
  b: LockedDepositWindow,
): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Deposit-slip-specific duplicate check: a commander legitimately appears on
 * multiple rows (one per deposit, plus a Locked row and its later
 * Matured/Looted terminal-state row for the same slip). The only genuinely
 * invalid state is two *simultaneously open* (`locked`) deposits for the same
 * commander — a duplicate investment, which the game does not allow. Detect
 * that via overlapping [depositAt, depositAt + termDays] windows rather than
 * simply counting rows per commander, so a Locked+Matured pair is never
 * flagged.
 */
export function findOverlappingLockedDepositSlips(
  rows: readonly DepositSlipReviewValidationRow[],
): DuplicateMemberIssue[] {
  const byIdentity = new Map<
    string,
    {
      displayName: string;
      entries: Array<{ id: string; window: LockedDepositWindow }>;
    }
  >();

  for (const row of rows) {
    if (isDeleted(row)) continue;
    if (row.profession !== "locked") continue;
    const name = row.ocrName?.trim();
    if (!name) continue;
    const window = lockedWindowForRow(row);
    if (!window) continue;

    const key = normalizeCommanderIdentityKey(name);
    const existing = byIdentity.get(key);
    if (existing) {
      existing.entries.push({ id: row.id, window });
    } else {
      byIdentity.set(key, { displayName: name, entries: [{ id: row.id, window }] });
    }
  }

  const issues: DuplicateMemberIssue[] = [];
  for (const [identityKey, { displayName, entries }] of byIdentity) {
    if (entries.length < 2) continue;
    const overlappingIds = new Set<string>();
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        if (lockedWindowsOverlap(entries[i]!.window, entries[j]!.window)) {
          overlappingIds.add(entries[i]!.id);
          overlappingIds.add(entries[j]!.id);
        }
      }
    }
    if (overlappingIds.size > 0) {
      issues.push({
        memberId: identityKey,
        memberName: displayName,
        rowIds: [...overlappingIds],
      });
    }
  }
  return issues;
}

export function duplicateDepositSlipRowIdsFromIssues(
  issues: readonly DuplicateMemberIssue[],
): Set<string> {
  return new Set(issues.flatMap((issue) => issue.rowIds));
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
  const duplicateMemberIssues = findOverlappingLockedDepositSlips(rows);
  const duplicateRowIds = duplicateDepositSlipRowIdsFromIssues(
    duplicateMemberIssues,
  );

  return {
    incompleteRowIds,
    unresolvedClusterIds,
    hasUnresolvedFlaggedClusters,
    duplicateMemberIssues,
    duplicateRowIds,
    // Overlapping locked deposits are returned as duplicateRowIds /
    // duplicateMemberIssues but intentionally omitted from canSubmitSlips —
    // ReviewExtractedData gates submit via hasDuplicateMembers separately so
    // this helper stays focused on incomplete rows + unresolved clusters.
    canSubmitSlips:
      activeRowCount > 0 &&
      incompleteRowIds.size === 0 &&
      !hasUnresolvedFlaggedClusters,
  };
}
