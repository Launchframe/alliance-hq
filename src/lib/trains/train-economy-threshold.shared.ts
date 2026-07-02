export type TrainEconomyThresholdSettings = {
  thresholdPoints: number | null;
  fudgePct: number;
};

/** Prior-day VS floor for The Price Is Right conductor pool (inclusive). */
export const PRICE_IS_RIGHT_MIN_VS_SCORE = 7_200_000;

export function normalizeTrainEconomyThresholdSettings(input: {
  thresholdPoints?: number | null;
  fudgePct?: number | null;
}): TrainEconomyThresholdSettings {
  const fudgeRaw = input.fudgePct ?? 1;
  const fudgePct = Math.min(100, Math.max(0, Math.trunc(fudgeRaw)));
  return {
    thresholdPoints: normalizeOptionalThreshold(input.thresholdPoints),
    fudgePct,
  };
}

function normalizeOptionalThreshold(
  value: number | null | undefined,
): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const n = Math.trunc(value);
  return n > 0 ? n : null;
}

export function economyThresholdEnforcementEnabled(
  settings: TrainEconomyThresholdSettings,
): boolean {
  return (settings.thresholdPoints ?? 0) > 0;
}

/** Upper bound: threshold + threshold × (fudgePct / 100). */
export function effectiveEconomyMaxVsScore(
  threshold: number,
  fudgePct: number,
): number {
  if (threshold <= 0) return 0;
  const pct = Math.min(100, Math.max(0, fudgePct));
  return Math.floor(threshold + threshold * (pct / 100));
}

/** Prior-day VS must fall in [PRICE_IS_RIGHT_MIN_VS_SCORE, effective max]. */
export function isVsScoreEconomyEligible(
  vsScore: number,
  threshold: number,
  fudgePct: number,
): boolean {
  const max = effectiveEconomyMaxVsScore(threshold, fudgePct);
  return (
    vsScore >= PRICE_IS_RIGHT_MIN_VS_SCORE &&
    vsScore <= max
  );
}

export function priceIsRightVsScoreRange(
  threshold: number,
  fudgePct: number,
): { min: number; max: number } {
  return {
    min: PRICE_IS_RIGHT_MIN_VS_SCORE,
    max: effectiveEconomyMaxVsScore(threshold, fudgePct),
  };
}
