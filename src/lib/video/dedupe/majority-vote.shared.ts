/**
 * Generic majority-vote resolution for a single field across a group of OCR rows.
 * Domain-agnostic — any dedupe engine (deposit slips, bank stronghold lists, event
 * scores, train cargo, ...) can use this to decide whether a disagreeing field is
 * likely OCR noise (a clear majority) or a genuine conflict (no majority).
 */

export type MajorityResult<T> = {
  value: T;
  agreeCount: number;
  totalCount: number;
};

/**
 * Groups the non-null `values` by `isEqual` and returns the largest group, but only
 * when it is a strict majority (more than half of the present values) *and* has at
 * least two members. A 1-of-2 or 1-of-3 split is not a majority — it still needs a
 * human to look at it.
 */
export function resolveByMajority<T>(
  values: readonly (T | null | undefined)[],
  isEqual: (a: T, b: T) => boolean = (a, b) => a === b,
): MajorityResult<T> | null {
  const present = values.filter((v): v is T => v != null);
  if (present.length === 0) return null;

  const groups: { value: T; count: number }[] = [];
  for (const value of present) {
    const existing = groups.find((g) => isEqual(g.value, value));
    if (existing) {
      existing.count += 1;
    } else {
      groups.push({ value, count: 1 });
    }
  }

  groups.sort((a, b) => b.count - a.count);
  const top = groups[0]!;
  if (top.count >= 2 && top.count > present.length / 2) {
    return { value: top.value, agreeCount: top.count, totalCount: present.length };
  }
  return null;
}
