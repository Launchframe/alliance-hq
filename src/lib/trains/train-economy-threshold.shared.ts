export type TrainEconomyThresholdSettings = {
  thresholdPoints: number | null;
  fudgePct: number;
};

/** Prior-day VS floor for The Price Is Right conductor pool (inclusive). */
export const PRICE_IS_RIGHT_MIN_VS_SCORE = 7_200_000;

/**
 * Default economy threshold for new alliances (upper band before fudge).
 * Null in DB still means "VS filtering off" for non-raffle draws.
 */
export const PRICE_IS_RIGHT_DEFAULT_ECONOMY_THRESHOLD_POINTS = 8_500_000;

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

/** Conductor draws: missing VS is treated as 0 (below the 7.2M floor). */
export function vsScoreForEconomyDraw(
  vsScore: number | null | undefined,
): number {
  return vsScore ?? 0;
}

/** API/UI: distinguish missing scores from a recorded zero. */
export function vsScoreForEconomyDisplay(
  scores: Map<string, number> | null | undefined,
  memberId: string,
): number | null {
  if (!scores || !scores.has(memberId)) {
    return null;
  }
  return scores.get(memberId) ?? null;
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

/**
 * TPIR pick-time filter over unselected pool rows. When only one member remains
 * in the alliance pool generation, they are always eligible (pool guarantee).
 * Takedown / max-ticket overrides stay eligible even above the economy band.
 */
export function tpirEligiblePoolEntries<T extends { memberId: string }>(
  unselected: T[],
  scores: Map<string, number>,
  settings: TrainEconomyThresholdSettings,
  maxTicketMemberIds: readonly string[] = [],
): T[] {
  if (unselected.length === 0) {
    return [];
  }
  if (unselected.length === 1) {
    return unselected;
  }
  if (!economyThresholdEnforcementEnabled(settings)) {
    return unselected;
  }

  const threshold = settings.thresholdPoints!;
  const overrides = new Set(maxTicketMemberIds);
  return unselected.filter((entry) => {
    if (overrides.has(entry.memberId)) return true;
    return isVsScoreEconomyEligible(
      vsScoreForEconomyDraw(scores.get(entry.memberId)),
      threshold,
      settings.fudgePct,
    );
  });
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
