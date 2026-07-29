import { activeDeposits } from "@/lib/banks/optimization.shared";
import { parsedRowFieldsToDepositSlipDraft } from "@/lib/banks/deposit-slip-ocr/draft-row.shared";
import {
  isHighConfidenceHistoricalDepositMatch,
  type HistoricalDepositSlipIdentity,
} from "@/lib/banks/deposit-slip-ocr/deposit-slip-history-match.shared";
import type {
  DepositStatus,
  SerializedDepositSlip,
} from "@/lib/banks/types.shared";

export type DepositSlipReviewHeroReviewRow = {
  deleted: number | boolean;
  profession?: string | null;
  ocrName?: string | null;
  score?: string | null;
  powerLevel?: string | null;
  memberLevel?: number | null;
};

export type DepositSlipReviewHeroBank = {
  currentDepositCount: number | null;
  cityListSnapshotAt?: string | null;
  depositSlips: readonly SerializedDepositSlip[];
};

export type DepositSlipReviewHeroMetrics = {
  active: {
    known: number;
    goal: number | null;
    snapshotAtIso: string | null;
  };
  matured: {
    hqTotal: number;
    inVideo: number;
  };
  looted: {
    hqTotal: number;
    inVideo: number;
  };
};

function isReviewRowDeleted(row: DepositSlipReviewHeroReviewRow): boolean {
  return row.deleted === true || row.deleted === 1;
}

function reviewRowStatus(
  row: DepositSlipReviewHeroReviewRow,
): DepositStatus {
  const profession = row.profession?.trim();
  if (profession === "matured" || profession === "looted") return profession;
  return "locked";
}

function countHqByStatus(
  slips: readonly SerializedDepositSlip[],
  status: DepositStatus,
): number {
  return slips.filter((slip) => slip.status === status).length;
}

function countVideoByStatus(
  rows: readonly DepositSlipReviewHeroReviewRow[],
  status: DepositStatus,
): number {
  return rows.filter(
    (row) => !isReviewRowDeleted(row) && reviewRowStatus(row) === status,
  ).length;
}

function slipToActiveIdentity(
  slip: SerializedDepositSlip,
): HistoricalDepositSlipIdentity {
  return {
    commanderName: slip.commanderName,
    depositAt: slip.depositAt,
    amount: slip.amount,
    termDays: slip.termDays,
    depositAllianceTag: slip.depositAllianceTag,
    status: slip.status,
  };
}

function reviewRowActiveIdentity(
  row: DepositSlipReviewHeroReviewRow,
): HistoricalDepositSlipIdentity | null {
  const draft = parsedRowFieldsToDepositSlipDraft({
    ocrName: row.ocrName ?? "",
    score: row.score ?? null,
    powerLevel: row.powerLevel ?? null,
    memberLevel: row.memberLevel ?? null,
    profession: row.profession ?? null,
    allianceRankTitle: null,
    rosterRankRaw: null,
    rank: null,
    frameIndex: null,
  });
  if (
    !draft ||
    draft.amount == null ||
    !draft.depositAt ||
    draft.termDays == null
  ) {
    return null;
  }
  return {
    commanderName: draft.identity.commanderName,
    depositAt: draft.depositAt,
    amount: draft.amount,
    termDays: draft.termDays,
    depositAllianceTag: draft.identity.allianceTag,
    status: draft.status,
  };
}

/**
 * Deposits are unique by [bank, commander, depositAt] (a bank is itself
 * unique by [server, coordX, coordY] — see `deposit-slip-bank-target-mismatch.shared.ts`).
 * A "locked" video row that matches a slip HQ already counts in `hqActive`
 * is a re-OCR of the same real-world deposit, not a new one — counting both
 * would double the Active hero card.
 */
function countNewVideoLockedDeposits(
  rows: readonly DepositSlipReviewHeroReviewRow[],
  activeSlips: readonly SerializedDepositSlip[],
): number {
  const activeIdentities = activeSlips.map(slipToActiveIdentity);
  let count = 0;
  for (const row of rows) {
    if (isReviewRowDeleted(row) || reviewRowStatus(row) !== "locked") continue;
    const identity = reviewRowActiveIdentity(row);
    const duplicatesActiveSlip =
      identity != null &&
      activeIdentities.some((existing) =>
        isHighConfidenceHistoricalDepositMatch(identity, existing),
      );
    if (!duplicatesActiveSlip) count += 1;
  }
  return count;
}

export function computeDepositSlipReviewHeroMetrics(input: {
  bank: DepositSlipReviewHeroBank | null | undefined;
  reviewRows: readonly DepositSlipReviewHeroReviewRow[];
  allianceCityListImportedAt?: string | null;
  now?: Date;
}): DepositSlipReviewHeroMetrics | null {
  const bank = input.bank;
  if (!bank) return null;

  const slips = bank.depositSlips ?? [];
  const activeSlips = activeDeposits(slips, input.now);
  const hqActive = activeSlips.length;
  const videoActive = countNewVideoLockedDeposits(
    input.reviewRows,
    activeSlips,
  );

  const snapshotAtIso =
    bank.cityListSnapshotAt?.trim() ||
    input.allianceCityListImportedAt?.trim() ||
    null;

  return {
    active: {
      known: hqActive + videoActive,
      goal: bank.currentDepositCount,
      snapshotAtIso,
    },
    matured: {
      hqTotal: countHqByStatus(slips, "matured"),
      inVideo: countVideoByStatus(input.reviewRows, "matured"),
    },
    looted: {
      hqTotal: countHqByStatus(slips, "looted"),
      inVideo: countVideoByStatus(input.reviewRows, "looted"),
    },
  };
}
