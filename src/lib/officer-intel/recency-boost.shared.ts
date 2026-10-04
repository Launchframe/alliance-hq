/** Small additive boost for newer approved notes — must not dominate cosine similarity. */
export const OFFICER_INTEL_RECENCY_BOOST_MAX = 0.05;
export const OFFICER_INTEL_RECENCY_HALF_LIFE_DAYS = 90;

export function officerIntelRecencyBoost(
  approvedAt: Date | null | undefined,
  now: Date = new Date(),
): number {
  if (!approvedAt) return 0;
  const ageMs = Math.max(0, now.getTime() - approvedAt.getTime());
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const decay = Math.exp(-ageDays / OFFICER_INTEL_RECENCY_HALF_LIFE_DAYS);
  return OFFICER_INTEL_RECENCY_BOOST_MAX * decay;
}

export function officerIntelScoreWithRecency(
  similarity: number,
  approvedAt: Date | null | undefined,
  now?: Date,
): number {
  return similarity + officerIntelRecencyBoost(approvedAt, now);
}
