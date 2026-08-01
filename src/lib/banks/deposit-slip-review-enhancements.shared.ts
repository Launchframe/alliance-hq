import { applyDepositSlipScoreDefaults } from "@/lib/banks/deposit-slip-score-default.shared";
import { interpolateMissingDepositSlipTimestamps } from "@/lib/banks/deposit-slip-timestamp-interpolation.shared";

export type DepositSlipReviewEnhancementSettings = {
  fillMissingDepositAmounts: boolean;
  fillMissingDepositTimes: boolean;
};

export type DepositSlipEnhanceableRow = {
  id: string;
  score: string | null;
  powerLevel?: string | null;
  frameIndex?: number | null;
  deleted: number | boolean;
  scoreDefaulted?: boolean;
  depositAtInterpolated?: boolean;
};

export function applyDepositSlipReviewEnhancements<
  T extends DepositSlipEnhanceableRow,
>(
  rows: readonly T[],
  settings: DepositSlipReviewEnhancementSettings,
): Array<T & { scoreDefaulted: boolean; depositAtInterpolated: boolean }> {
  const withScores = settings.fillMissingDepositAmounts
    ? applyDepositSlipScoreDefaults(rows)
    : rows.map((row) => ({
        ...row,
        scoreDefaulted: row.scoreDefaulted ?? false,
      }));

  return interpolateMissingDepositSlipTimestamps(withScores, {
    enabled: settings.fillMissingDepositTimes,
  });
}
