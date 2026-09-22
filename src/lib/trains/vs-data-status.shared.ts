/**
 * Pure helpers for Trains Simple Mode VS / Price Is Freight score readiness.
 * Server loaders fetch scores; these classify need and build the payload shape.
 */

import type { ConductorRule } from "@/lib/trains/rules/catalog.shared";
import { conductorRuleUsesVsScores } from "@/lib/trains/rules/derive.shared";
import { vsScoreContextForTrainDate } from "@/lib/trains/vs-week-days.shared";

export type TrainsVsDataStatusKind = "vr" | "prior_day_vs" | "none";

export type TrainsVsDataStatus = {
  required: boolean;
  ready: boolean;
  scoreCount: number;
  kind: TrainsVsDataStatusKind;
  /** Prior-day VS recorded date when kind is `prior_day_vs`. */
  scoreDate?: string;
  /** Members eligible under the day's rule (when score stats are loaded). */
  eligibleCount?: number;
  /** VS match day key for the score source date (Radar Training, …). */
  vsDayKey?:
    | "radarTraining"
    | "baseExpansion"
    | "ageOfScience"
    | "heroDay"
    | "totalMobilization"
    | "busterDay"
    | null;
  /** Top N scope when the rule is a top board. */
  topN?: number;
};

export type ClassifyVsDataNeedInput = {
  rule: ConductorRule | null;
  /** Train calendar date — gates prior-day VS (e.g. Monday → Sunday break). */
  trainDate?: string | null;
  /** Alliance lead-time days (shifts score reference date). */
  leadDays?: number;
  /** Rule painted on the VS score reference date (lead time ≥ 1). */
  scoreDayRule?: ConductorRule | null;
};

/** True when the score reference day's rule reads prior-day VS scores. */
export function scoreDayRuleUsesPriorDayVsScores(
  rule: ConductorRule | null | undefined,
): boolean {
  return conductorRuleUsesVsScores(rule ?? null);
}

/**
 * Score reference date is a VS match day (Mon–Sat). With leadDays=0, Monday
 * trains use Sunday (break) → no prior-day VS. With leadDays=1, Monday uses
 * Saturday (Buster Day) scores.
 */
export function priorDayVsAppliesForTrainDate(
  trainDate: string,
  leadDays = 0,
): boolean {
  const { vsDayNumber } = vsScoreContextForTrainDate(trainDate, leadDays);
  return vsDayNumber != null;
}

/**
 * Decide whether today's conductor flow needs score data and which source.
 * Top VS (`vs_high_score` / `vs_top_10` / `vs_top_n`) and Price Is Freight use
 * prior-day Ashed VS. Economy Week probes the same source without requiring it.
 * Top VR (`vr_top_n`) uses season HQ VR.
 */
export function classifyVsDataNeed(
  input: ClassifyVsDataNeedInput,
): { kind: TrainsVsDataStatusKind; required: boolean } {
  const rule = input.rule;
  const leadDays = input.leadDays ?? 0;

  // The manual R3 award is an officer pick — no score upload gate.
  if (rule?.kind === "rank_pool" && rule.draw === "manual") {
    return { kind: "none", required: false };
  }

  if (rule?.kind === "vr_top_n") {
    return { kind: "vr", required: true };
  }

  const priorDayVsOk =
    input.trainDate == null ||
    input.trainDate === "" ||
    priorDayVsAppliesForTrainDate(input.trainDate, leadDays);

  if (!priorDayVsOk) {
    return { kind: "none", required: false };
  }

  if (conductorRuleUsesVsScores(rule)) {
    return { kind: "prior_day_vs", required: true };
  }

  // The R3 wheel still probes prior-day VS so officers can confirm “everyone
  // is eligible,” but missing scores must not block the spin.
  if (rule?.kind === "rank_pool" && rule.pool === "r3") {
    return { kind: "prior_day_vs", required: false };
  }

  // Lead time ≥ 1: off-template days (Sun VS break, Mon R4, …) inherit the
  // score reference day's VS context (e.g. Sun → Fri Total Mobilization).
  if (leadDays > 0 && input.trainDate && input.scoreDayRule) {
    if (scoreDayRuleUsesPriorDayVsScores(input.scoreDayRule)) {
      return { kind: "prior_day_vs", required: false };
    }
  }

  return { kind: "none", required: false };
}

/**
 * Economy Week may spin without scores. Prompt only when we probed prior-day
 * VS and the count is zero.
 */
export function shouldConfirmEconomyWeekWithoutScores(input: {
  rule?: ConductorRule | null;
  vsDataStatus?: Pick<TrainsVsDataStatus, "kind" | "scoreCount"> | null;
}): boolean {
  return (
    input.rule?.kind === "rank_pool" &&
    input.rule.pool === "r3" &&
    input.rule.draw === "wheel" &&
    input.vsDataStatus?.kind === "prior_day_vs" &&
    input.vsDataStatus.scoreCount === 0
  );
}

/** Build a status object from a classified need + fetched score count. */
export function buildVsDataStatus(input: {
  kind: TrainsVsDataStatusKind;
  required: boolean;
  scoreCount: number;
  scoreDate?: string;
  eligibleCount?: number;
  vsDayKey?: TrainsVsDataStatus["vsDayKey"];
  topN?: number;
}): TrainsVsDataStatus {
  const ready = !input.required || input.scoreCount > 0;
  return {
    required: input.required,
    ready,
    scoreCount: input.scoreCount,
    kind: input.kind,
    ...(input.scoreDate !== undefined ? { scoreDate: input.scoreDate } : {}),
    ...(input.eligibleCount !== undefined
      ? { eligibleCount: input.eligibleCount }
      : {}),
    ...(input.vsDayKey !== undefined ? { vsDayKey: input.vsDayKey } : {}),
    ...(input.topN !== undefined ? { topN: input.topN } : {}),
  };
}
