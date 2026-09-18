/**
 * Day-scoped spin exclusions for non-deterministic conductor draws
 * (Top VS/VR with scope > 1, R3 lottery, heavy-hitter lottery, Price Is Freight).
 * Drawn members stay out of further spins for that calendar date only —
 * independent of long-running R3 / R4+ depleting generation slots.
 */

import type { ConductorRule } from "@/lib/trains/rules/catalog.shared";
import { conductorRuleIsAutomatic } from "@/lib/trains/rules/derive.shared";

export function filterDaySpinCandidates<T extends { memberId: string }>(
  candidates: readonly T[],
  excludedMemberIds: ReadonlySet<string>,
): T[] {
  if (excludedMemberIds.size === 0) return [...candidates];
  return candidates.filter((c) => !excludedMemberIds.has(c.memberId));
}

/** Merge stored exclusions with the current draft conductor (being replaced). */
export function buildDaySpinExclusionSet(input: {
  storedMemberIds: readonly string[];
  currentDraftMemberId?: string | null;
}): Set<string> {
  const excluded = new Set(input.storedMemberIds);
  const draft = input.currentDraftMemberId?.trim();
  if (draft) excluded.add(draft);
  return excluded;
}

/**
 * True when a conductor draw has P(winner) < 1 among eligible candidates.
 * Top VS scope 1 and R4 sequence are deterministic and do not use day exclusions.
 */
export function usesDaySpinExclusions(input: {
  rule: ConductorRule | null;
}): boolean {
  const rule = input.rule;
  if (!rule) return false;
  if (conductorRuleIsAutomatic(rule)) return false;
  // R4 rotation walks the pool in order — the draw is deterministic.
  if (rule.kind === "rank_pool" && rule.pool === "r4_plus") return false;
  return true;
}
