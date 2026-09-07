/**
 * Freddy demotion ladder (strike-based, not one-step):
 * - strike 1 → target rank R2
 * - strike 2 → target rank R1
 * - strike 3+ → kick task (no demotion target; callers use `vsComplianceTaskKindForStrike`)
 *
 * Returns null when the strike is at/above the kick threshold or input is invalid.
 */
export function freddyDemotionTargetRank(
  strikeCount: number,
  missStrikesBeforeKick = 3,
): number | null {
  if (!Number.isFinite(strikeCount)) return null;
  const strike = Math.trunc(strikeCount);
  if (strike < 1) return null;
  if (strike >= missStrikesBeforeKick) return null;
  if (strike === 1) return 2;
  if (strike === 2) return 1;
  // Strikes between 3 and missStrikesBeforeKick-1 (custom thresholds > 3)
  // still demote toward R1 rather than inventing intermediate ranks.
  return 1;
}
