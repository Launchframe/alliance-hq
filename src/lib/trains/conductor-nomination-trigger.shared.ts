/**
 * Pure helpers for when auto-nomination may run for a train day.
 * Distinct from classifyVsDataNeed (guided upload UX).
 */

import { effectiveConductorMechanism } from "@/lib/trains/conductor-mechanism.shared";
import {
  resolveNominationTopBoard,
  scoreDateForTrainDay,
} from "@/lib/trains/train-day-context.shared";
import type { DayMechanismConfig } from "@/lib/trains/vs-score-scope.shared";

export type ConductorNominationTrigger =
  | { mode: "score_upload"; kind: "prior_day_vs" | "vr"; scoreDate: string }
  | { mode: "scheduled_reset"; anchor: "day_before_train" }
  | { mode: "manual" };

export type ResolveConductorNominationTriggerInput = {
  conductorMechanism: string | null | undefined;
  paintTemplate?: string | null;
  trainDate: string;
  leadDays?: number;
  conductorConfig?: unknown;
  /** Painted rule for the VS score reference date when lead time ≥ 1. */
  scoreDateDay?: DayMechanismConfig | null;
};

const MANUAL_MECHANISMS = new Set([
  "r3_recognition",
  "donations_top",
  "officer_pick",
  "custom",
]);

const POOL_SCHEDULED_MECHANISMS = new Set([
  "r3_lottery",
  "r4_sequence",
  "heavy_hitter_lottery",
  "event_top_x_lottery",
]);

export function resolveConductorNominationTrigger(
  input: ResolveConductorNominationTriggerInput,
): ConductorNominationTrigger {
  const leadDays = input.leadDays ?? 0;
  const paint = input.paintTemplate ?? null;
  const mechanism =
    effectiveConductorMechanism(
      input.conductorMechanism,
      paint as Parameters<typeof effectiveConductorMechanism>[1],
      input.trainDate,
    ) ?? input.conductorMechanism;

  if (
    paint === "r3_recognition" ||
    (mechanism != null && MANUAL_MECHANISMS.has(mechanism))
  ) {
    return { mode: "manual" };
  }

  const scoreDate = scoreDateForTrainDay(input.trainDate, leadDays);
  const topBoard = resolveNominationTopBoard({
    trainDate: input.trainDate,
    trainDay: {
      conductorMechanism: mechanism,
      conductorConfig: input.conductorConfig,
      paintTemplate: paint,
    },
    leadDays,
    scoreDateDay: input.scoreDateDay,
  });
  if (topBoard?.kind === "vr") {
    return {
      mode: "score_upload",
      kind: "vr",
      scoreDate,
    };
  }
  if (topBoard?.kind === "vs") {
    return {
      mode: "score_upload",
      kind: "prior_day_vs",
      scoreDate,
    };
  }

  if (
    mechanism === "vs_high_score" ||
    mechanism === "vs_top_10" ||
    mechanism === "vs_top_n"
  ) {
    return {
      mode: "score_upload",
      kind: "prior_day_vs",
      scoreDate,
    };
  }

  if (mechanism === "vr_top_n") {
    return {
      mode: "score_upload",
      kind: "vr",
      scoreDate,
    };
  }

  // Economy / PIF / HH / R4 pools: winner is not score-determined for nomination.
  if (mechanism != null && POOL_SCHEDULED_MECHANISMS.has(mechanism)) {
    return { mode: "scheduled_reset", anchor: "day_before_train" };
  }

  return { mode: "manual" };
}
