/**
 * Generic "fold anchor-less rows into a matching cluster by name" pass.
 * Domain-agnostic over what the "anchor" is — a to-the-minute timestamp for
 * deposit slips today, but could be a trip id, event window, etc. for other OCR
 * domains. Rows with no anchor at all would otherwise never be compared against
 * anything; this pass gives them one more chance to match a same-named row/cluster
 * before falling back to a lone, incomplete row.
 */

import {
  bestNameSimilarity,
  clusterByFuzzyName,
  FUZZY_AUTO_MERGE_THRESHOLD,
} from "@/lib/video/dedupe/fuzzy-name-cluster.shared";

export type MissingAnchorMatch<T> = {
  destination: T;
  anchorlessRows: T[];
};

export type MissingAnchorAmbiguousGroup<T> = {
  group: T[];
  /**
   * Anchored destinations that fuzzy-matched this group's name closely enough
   * to be considered, but the match was ambiguous (multiple candidates, or one
   * candidate with a field conflict). Empty when the group's own members
   * conflict with each other and no destination was involved at all.
   */
  matchedDestinations: T[];
};

export type MissingAnchorReconciliation<T> = {
  /** Anchor-less rows that matched exactly one anchored destination with compatible fields. */
  mergedIntoDestination: MissingAnchorMatch<T>[];
  /** Anchor-less rows that matched each other but no anchored destination — collapse into one. */
  mergedAmongThemselves: T[][];
  /** Matched a destination (or more than one) but fields conflict, or the match is ambiguous. */
  ambiguous: MissingAnchorAmbiguousGroup<T>[];
  /** No name match found anywhere — leave as a normal singleton. */
  untouched: T[];
};

export function reconcileMissingAnchorRows<T>(
  anchorlessRows: readonly T[],
  anchoredDestinations: readonly T[],
  opts: {
    getName: (item: T) => string;
    /** True when the given rows (anchorless rows, optionally + a candidate destination) have no unresolved conflicts. */
    isCompatible: (rows: readonly T[]) => boolean;
    threshold?: number;
  },
): MissingAnchorReconciliation<T> {
  const threshold = opts.threshold ?? FUZZY_AUTO_MERGE_THRESHOLD;
  const result: MissingAnchorReconciliation<T> = {
    mergedIntoDestination: [],
    mergedAmongThemselves: [],
    ambiguous: [],
    untouched: [],
  };
  if (anchorlessRows.length === 0) return result;

  const nameGroups = clusterByFuzzyName(anchorlessRows, opts.getName, {
    threshold,
    includeSingletons: true,
  });

  for (const group of nameGroups) {
    const groupNames = group.map(opts.getName);
    const matchedDestinations = anchoredDestinations.filter(
      (dest) =>
        bestNameSimilarity(groupNames, [opts.getName(dest)]) >= threshold,
    );

    if (matchedDestinations.length === 1) {
      const destination = matchedDestinations[0]!;
      if (opts.isCompatible([...group, destination])) {
        result.mergedIntoDestination.push({ destination, anchorlessRows: group });
      } else {
        result.ambiguous.push({ group, matchedDestinations });
      }
      continue;
    }

    if (matchedDestinations.length > 1) {
      result.ambiguous.push({ group, matchedDestinations });
      continue;
    }

    if (group.length > 1) {
      if (opts.isCompatible(group)) {
        result.mergedAmongThemselves.push(group);
      } else {
        result.ambiguous.push({ group, matchedDestinations: [] });
      }
      continue;
    }

    result.untouched.push(group[0]!);
  }

  return result;
}
