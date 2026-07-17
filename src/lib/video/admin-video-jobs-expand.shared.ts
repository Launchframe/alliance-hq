/**
 * Pure helpers for expanding admin video job list results with upload-group
 * siblings (primary/shadow passes) when filters would otherwise split them.
 */

/** Skip sibling expansion when filtering to a single pass or when nothing matched. */
export function shouldExpandAdminVideoJobUploadGroups(
  passKey: string | null | undefined,
  matchedCount: number,
): boolean {
  return matchedCount > 0 && !passKey;
}

/**
 * Append group siblings not already in `matched`, preserving matched order
 * first so downstream grouping keeps first-seen positions stable.
 */
export function mergeAdminVideoJobMatchesWithGroupSiblings<
  T extends { id: string },
>(matched: readonly T[], siblings: readonly T[]): T[] {
  if (matched.length === 0) return [];
  const seen = new Set(matched.map((job) => job.id));
  const ordered = [...matched];
  for (const job of siblings) {
    if (!seen.has(job.id)) {
      ordered.push(job);
      seen.add(job.id);
    }
  }
  return ordered;
}
