/** One-step demotion on the R1 (lowest)–R5 (highest) scale; null when already at R1. */
export function demotedAllianceRank(currentRank: number): number | null {
  if (!Number.isFinite(currentRank)) return null;
  const rank = Math.trunc(currentRank);
  if (rank <= 1) return null;
  if (rank > 5) return 5;
  return rank - 1;
}
