import { parsedRowFieldsToDepositSlipDraft } from "@/lib/banks/deposit-slip-ocr/draft-row.shared";
import {
  findHistoricalDepositMatch,
  shouldSkipHistoricalDepositDuplicate,
  shouldUpdateHistoricalDepositOutcome,
  type HistoricalDepositSlipIdentity,
} from "@/lib/banks/deposit-slip-ocr/deposit-slip-history-match.shared";
import type { DepositSlipReviewValidationRow } from "@/lib/banks/deposit-slip-review-validation.shared";
import type { SerializedDepositSlip } from "@/lib/banks/types.shared";
import { normalizeEntityName } from "@/lib/video/dedupe/fuzzy-name-cluster.shared";

function isDeleted(row: DepositSlipReviewValidationRow): boolean {
  return row.deleted === true || row.deleted === 1;
}

function slipToHistoricalIdentity(
  slip: SerializedDepositSlip,
): HistoricalDepositSlipIdentity {
  return {
    commanderName: slip.commanderName,
    depositAt: slip.depositAt,
    amount: slip.amount,
    termDays: slip.termDays,
    depositAllianceTag: slip.depositAllianceTag,
    status: slip.status,
    outcomeAt: slip.outcomeAt,
    allianceMemberId: slip.allianceMemberId,
  };
}

function resolvePreviewAllianceMemberId(
  row: Pick<
    DepositSlipReviewValidationRow,
    "memberId" | "memberName" | "ocrName"
  >,
  history: readonly SerializedDepositSlip[],
): string | null {
  if (!row.memberId?.trim()) return null;
  const canonicalName = (row.memberName ?? row.ocrName)?.trim();
  if (!canonicalName) return null;

  for (const slip of history) {
    if (
      slip.allianceMemberId &&
      normalizeEntityName(slip.commanderName) ===
        normalizeEntityName(canonicalName)
    ) {
      return slip.allianceMemberId;
    }
  }
  return null;
}

export function reviewRowToHistoricalIdentity(
  row: DepositSlipReviewValidationRow,
  history: readonly SerializedDepositSlip[] = [],
): HistoricalDepositSlipIdentity | null {
  if (isDeleted(row)) return null;

  const draft = parsedRowFieldsToDepositSlipDraft({
    ocrName: row.memberName ?? row.ocrName,
    score: row.score ?? null,
    powerLevel: row.powerLevel ?? null,
    memberLevel: row.memberLevel ?? null,
    profession: row.profession ?? null,
    allianceRankTitle: row.allianceRankTitle ?? null,
    rosterRankRaw: row.rosterRankRaw ?? null,
    rank: null,
    frameIndex: row.frameIndex ?? null,
  });
  if (!draft || draft.amount == null || !draft.depositAt || draft.termDays == null) {
    return null;
  }

  const commanderName =
    row.memberName?.trim() || row.ocrName?.trim() || draft.identity.commanderName;
  if (!commanderName) return null;

  return {
    commanderName,
    depositAt: draft.depositAt,
    amount: draft.amount,
    termDays: draft.termDays,
    depositAllianceTag: draft.identity.allianceTag,
    status: draft.status,
    outcomeAt: draft.outcomeAt,
    allianceMemberId: resolvePreviewAllianceMemberId(row, history),
  };
}

export type DepositSlipHistoryPreviewCounts = {
  skipCount: number;
  updateCount: number;
};

export function countReviewRowsMatchingBankHistory(
  rows: readonly DepositSlipReviewValidationRow[],
  history: readonly SerializedDepositSlip[],
): DepositSlipHistoryPreviewCounts {
  const historyIdentities = history.map(slipToHistoricalIdentity);
  let skipCount = 0;
  let updateCount = 0;

  for (const row of rows) {
    const incoming = reviewRowToHistoricalIdentity(row, history);
    if (!incoming) continue;

    const match = findHistoricalDepositMatch(incoming, historyIdentities);
    if (!match) continue;

    if (shouldUpdateHistoricalDepositOutcome(incoming, match)) {
      updateCount += 1;
      continue;
    }
    if (shouldSkipHistoricalDepositDuplicate(incoming, match)) {
      skipCount += 1;
    }
  }

  return { skipCount, updateCount };
}
