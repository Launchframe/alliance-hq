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
 * External-signal tiebreaker used only when no strict local majority exists
 * (e.g. a 1-of-2 or 2-of-2 split). `score` ranks each *distinct* value seen in
 * the tied group — typically a frequency count of that value elsewhere in the
 * same batch (a poor man's "which reading is more plausible overall" signal).
 * The winner must both clear `minWinnerScore` and beat the runner-up by
 * `minRatio`, so a close call (e.g. 5 vs 4) still falls through to flagging —
 * this is meant for clear-cut cases (e.g. 49 vs 3), not soft signals.
 */
export type MajorityTieBreak<T> = {
  score: (value: T) => number;
  minWinnerScore?: number;
  minRatio?: number;
  /**
   * Optional domain guard for deciding whether the winning external signal is
   * actually relevant to every tied alternative. For example, an alliance-tag
   * frequency should only correct a likely OCR variant, not overwrite a wholly
   * different tag that may represent a real identity conflict.
   */
  canResolve?: (winner: T, alternatives: readonly T[]) => boolean;
};

/**
 * Groups the non-null `values` by `isEqual` and returns the largest group, but only
 * when it is a strict majority (more than half of the present values) *and* has at
 * least two members. A 1-of-2 or 1-of-3 split is not a majority — it still needs a
 * human to look at it, unless `tieBreak` finds one candidate overwhelmingly more
 * plausible than the others (see `MajorityTieBreak`).
 */
export function resolveByMajority<T>(
  values: readonly (T | null | undefined)[],
  isEqual: (a: T, b: T) => boolean = (a, b) => a === b,
  tieBreak?: MajorityTieBreak<T>,
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

  if (tieBreak && groups.length >= 2) {
    const tiedForTop = groups.filter((g) => g.count === top.count);
    // A plurality such as 2-1-1 has no strict majority, but it is not a tie.
    // External evidence must not turn that existing plurality into an automatic
    // correction; the tiebreaker is intentionally limited to tied local votes.
    if (tiedForTop.length < 2) return null;

    const scored = tiedForTop
      .map((g) => ({ ...g, score: tieBreak.score(g.value) }))
      .sort((a, b) => b.score - a.score);
    const best = scored[0]!;
    const runnerUp = scored[1];
    const minWinnerScore = tieBreak.minWinnerScore ?? 5;
    const minRatio = tieBreak.minRatio ?? 3;
    const clearsRunnerUp =
      !runnerUp ||
      (runnerUp.score === 0 ? best.score > 0 : best.score / runnerUp.score >= minRatio);
    const alternatives = scored.slice(1).map((candidate) => candidate.value);
    const domainAllowsResolution =
      !tieBreak.canResolve || tieBreak.canResolve(best.value, alternatives);
    if (best.score >= minWinnerScore && clearsRunnerUp && domainAllowsResolution) {
      return { value: best.value, agreeCount: best.count, totalCount: present.length };
    }
  }

  return null;
}
