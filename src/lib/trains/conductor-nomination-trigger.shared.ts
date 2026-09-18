/**
 * When auto-nomination may run for a train day.
 * Distinct from classifyVsDataNeed (guided upload UX).
 */

import type { ConductorRule } from "@/lib/trains/rules/catalog.shared";
import {
  resolveNominationTopBoard,
  scoreDateForTrainDay,
} from "@/lib/trains/train-day-context.shared";

export type ConductorNominationTrigger =
  | { mode: "score_upload"; kind: "prior_day_vs" | "vr"; scoreDate: string }
  | { mode: "scheduled_reset"; anchor: "day_before_train" }
  | { mode: "manual" };

export type ResolveConductorNominationTriggerInput = {
  rule: ConductorRule | null;
  trainDate: string;
  leadDays?: number;
  /** Rule painted on the VS score reference date when lead time ≥ 1. */
  scoreDayRule?: ConductorRule | null;
};

export function resolveConductorNominationTrigger(
  input: ResolveConductorNominationTriggerInput,
): ConductorNominationTrigger {
  const leadDays = input.leadDays ?? 0;
  const rule = input.rule;

  // Free choice, manual R3 award, and donations are all officer-driven.
  if (!rule) return { mode: "manual" };
  if (rule.kind === "rank_pool" && rule.draw === "manual") {
    return { mode: "manual" };
  }
  if (rule.kind === "donations_top") return { mode: "manual" };

  const scoreDate = scoreDateForTrainDay(input.trainDate, leadDays);
  const topBoard = resolveNominationTopBoard({
    trainRule: rule,
    leadDays,
    scoreDayRule: input.scoreDayRule,
  });
  if (topBoard?.kind === "vr") {
    return { mode: "score_upload", kind: "vr", scoreDate };
  }
  if (topBoard?.kind === "vs") {
    return { mode: "score_upload", kind: "prior_day_vs", scoreDate };
  }

  // Pools and Price Is Freight: the winner is not score-determined, so
  // nomination runs on the scheduled reset instead of a score upload.
  return { mode: "scheduled_reset", anchor: "day_before_train" };
}
