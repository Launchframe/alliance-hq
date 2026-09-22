export const TRAIN_TOP_SCORE_MINIMUM_RANKS = [1, 2, 3] as const;
export type TrainTopScoreMinimumRank =
  (typeof TRAIN_TOP_SCORE_MINIMUM_RANKS)[number];
export type TrainTopScoreEligibilitySettings = {
  trainTopScoreMinRank: TrainTopScoreMinimumRank;
  trainTopScoreIncludesR4Plus: boolean;
};
export function normalizeTrainTopScoreMinimumRank(
  value: unknown,
): TrainTopScoreMinimumRank {
  return value === 1 || value === 2 ? value : 3;
}
export function isMemberEligibleForTopScoreTrain(
  rank: number | null | undefined,
  trainTopScoreMinRank: TrainTopScoreMinimumRank,
  trainTopScoreIncludesR4Plus: boolean,
): boolean {
  const effectiveRank = rank ?? 1;
  if (effectiveRank >= 1 && effectiveRank <= 3)
    return effectiveRank >= trainTopScoreMinRank;
  if (effectiveRank === 4 || effectiveRank === 5)
    return trainTopScoreIncludesR4Plus;
  return false;
}
