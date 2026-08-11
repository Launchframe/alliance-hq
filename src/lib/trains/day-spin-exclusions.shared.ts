/**
 * Day-scoped spin exclusions for non-deterministic conductor draws
 * (Top VS/VR with scope > 1, R3 lottery, heavy-hitter lottery, Price Is Freight).
 * Drawn members stay out of further spins for that calendar date only —
 * independent of long-running R3 / R4+ depleting generation slots.
 */

import {
  isAutomaticTopNBoard,
  type ResolvedConductorTopNBoard,
} from "@/lib/trains/conductor-top-n.shared";
import { usesPriceIsFreightConductorRoll } from "@/lib/trains/heavy-hitter-pool.shared";
import type {
  ConductorMechanismType,
  WeekTemplateType,
} from "@/lib/trains/types";

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
  mechanism: ConductorMechanismType | string | null | undefined;
  topBoard?: ResolvedConductorTopNBoard | null;
  paintTemplate?: WeekTemplateType | null;
}): boolean {
  const topBoard = input.topBoard ?? null;
  if (topBoard) {
    return !isAutomaticTopNBoard(topBoard);
  }

  const mechanism = input.mechanism;
  if (mechanism === "r4_sequence") return false;
  if (mechanism === "r3_lottery" || mechanism === "heavy_hitter_lottery") {
    return true;
  }
  if (usesPriceIsFreightConductorRoll(input.paintTemplate)) {
    return true;
  }
  return false;
}
