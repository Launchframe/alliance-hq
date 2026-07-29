import { activeDeposits } from "@/lib/banks/optimization.shared";
import type {
  DepositStatus,
  SerializedDepositSlip,
} from "@/lib/banks/types.shared";

export type DepositSlipReviewHeroReviewRow = {
  deleted: number | boolean;
  profession?: string | null;
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

export function computeDepositSlipReviewHeroMetrics(input: {
  bank: DepositSlipReviewHeroBank | null | undefined;
  reviewRows: readonly DepositSlipReviewHeroReviewRow[];
  allianceCityListImportedAt?: string | null;
  now?: Date;
}): DepositSlipReviewHeroMetrics | null {
  const bank = input.bank;
  if (!bank) return null;

  const slips = bank.depositSlips ?? [];
  const hqActive = activeDeposits(slips, input.now).length;
  const videoActive = countVideoByStatus(input.reviewRows, "locked");

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
