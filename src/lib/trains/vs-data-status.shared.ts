/**
 * Pure helpers for Trains Simple Mode VS / Price Is Freight score readiness.
 * Server loaders fetch scores; these classify need and build the payload shape.
 */

import { paintTemplateUsesPriorDayVs } from "@/lib/trains/heavy-hitter-pool.shared";
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
  conductorMechanism: string | null | undefined;
  /** Day paint / week template (e.g. `price_is_right`). */
  paintTemplate?: string | null;
  /** Train calendar date — gates prior-day VS (e.g. Monday → Sunday break). */
  trainDate?: string | null;
  /** Alliance lead-time days (shifts score reference date). */
  leadDays?: number;
};

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
  const mech = input.conductorMechanism;
  const leadDays = input.leadDays ?? 0;

  // R3 recognition is manual award pick only — no score upload gate.
  if (input.paintTemplate === "r3_recognition") {
    return { kind: "none", required: false };
  }

  if (mech === "vr_top_n") {
    return { kind: "vr", required: true };
  }

  const priorDayVsOk =
    input.trainDate == null ||
    input.trainDate === "" ||
    priorDayVsAppliesForTrainDate(input.trainDate, leadDays);

  if (!priorDayVsOk) {
    return { kind: "none", required: false };
  }

  if (
    mech === "vs_high_score" ||
    mech === "vs_top_10" ||
    mech === "vs_top_n" ||
    mech === "heavy_hitter_lottery"
  ) {
    return { kind: "prior_day_vs", required: true };
  }

  // Economy Week still probes prior-day VS so officers can confirm “everyone
  // is eligible,” but missing scores must not block the spin.
  if (mech === "r3_lottery" && input.paintTemplate === "economy_week") {
    return { kind: "prior_day_vs", required: false };
  }

  if (
    mech === "r3_lottery" &&
    paintTemplateUsesPriorDayVs(input.paintTemplate)
  ) {
    return { kind: "prior_day_vs", required: true };
  }

  return { kind: "none", required: false };
}

/**
 * Economy Week may spin without scores. Prompt only when we probed prior-day
 * VS and the count is zero.
 */
export function shouldConfirmEconomyWeekWithoutScores(input: {
  paintTemplate?: string | null;
  vsDataStatus?: Pick<TrainsVsDataStatus, "kind" | "scoreCount"> | null;
}): boolean {
  return (
    input.paintTemplate === "economy_week" &&
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
