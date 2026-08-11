/**
 * Day-scoped Top VS / Top VR spin exclusions (scope N > 1).
 * Drawn members stay out of further spins for that calendar date only —
 * independent of long-running R3 / R4+ depleting pools.
 */

export function filterTopScoreSpinCandidates<T extends { memberId: string }>(
  candidates: readonly T[],
  excludedMemberIds: ReadonlySet<string>,
): T[] {
  if (excludedMemberIds.size === 0) return [...candidates];
  return candidates.filter((c) => !excludedMemberIds.has(c.memberId));
}

/** Merge stored exclusions with the current draft conductor (being replaced). */
export function buildTopScoreSpinExclusionSet(input: {
  storedMemberIds: readonly string[];
  currentDraftMemberId?: string | null;
}): Set<string> {
  const excluded = new Set(input.storedMemberIds);
  const draft = input.currentDraftMemberId?.trim();
  if (draft) excluded.add(draft);
  return excluded;
}
