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

/**
 * Overlay display/submit enhancements onto persisted review rows. When the
 * officer clears an interpolated timestamp, keep it empty instead of re-filling.
 */
export function mergeDepositSlipDisplayEnhancements<
  T extends DepositSlipEnhanceableRow,
>(
  activeRows: readonly T[],
  settings: DepositSlipReviewEnhancementSettings,
): Array<T & { scoreDefaulted: boolean; depositAtInterpolated: boolean }> {
  const enhanced = applyDepositSlipReviewEnhancements(activeRows, settings);
  const enhancedById = new Map(enhanced.map((row) => [row.id, row]));

  return activeRows.map((row) => {
    const patch = enhancedById.get(row.id);
    if (!patch) {
      return {
        ...row,
        scoreDefaulted: row.scoreDefaulted ?? false,
        depositAtInterpolated: row.depositAtInterpolated ?? false,
      };
    }

    const officerRejectedInterpolation =
      row.depositAtInterpolated === false &&
      !(row.powerLevel?.trim() ?? "") &&
      patch.depositAtInterpolated;

    if (officerRejectedInterpolation) {
      return {
        ...row,
        score: patch.score,
        scoreDefaulted: patch.scoreDefaulted,
        depositAtInterpolated: false,
      };
    }

    return {
      ...row,
      score: patch.score,
      powerLevel: patch.powerLevel,
      scoreDefaulted: patch.scoreDefaulted,
      depositAtInterpolated: patch.depositAtInterpolated,
    };
  });
}
