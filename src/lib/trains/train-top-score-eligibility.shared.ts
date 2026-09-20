export type TrainTopScoreEligibilitySettings = {
  trainTopScoreIncludesR4Plus: boolean;
};

export function isMemberEligibleForTopScoreTrain(
  rank: number | null | undefined,
  trainTopScoreIncludesR4Plus: boolean,
): boolean {
  if (rank === 3) return true;
  return trainTopScoreIncludesR4Plus && rank != null && rank >= 4;
}
