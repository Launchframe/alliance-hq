/**
 * Pure helpers for Trains Simple Mode VS / Price Is Freight score readiness.
 * Server loaders fetch scores; these classify need and build the payload shape.
 */

import { isPriceIsRightPaintTemplate } from "@/lib/trains/heavy-hitter-pool.shared";

export type TrainsVsDataStatusKind = "vr" | "prior_day_vs" | "none";

export type TrainsVsDataStatus = {
  required: boolean;
  ready: boolean;
  scoreCount: number;
  kind: TrainsVsDataStatusKind;
  /** Prior-day VS recorded date when kind is `prior_day_vs`. */
  scoreDate?: string;
};

export type ClassifyVsDataNeedInput = {
  conductorMechanism: string | null | undefined;
  /** Day paint / week template (e.g. `price_is_right`). */
  paintTemplate?: string | null;
};

/**
 * Decide whether today's conductor flow needs score data and which source.
 * VS wheel mechanisms use HQ season VR; Price Is Freight uses prior-day VS.
 */
export function classifyVsDataNeed(
  input: ClassifyVsDataNeedInput,
): { kind: TrainsVsDataStatusKind; required: boolean } {
  const mech = input.conductorMechanism;
  if (mech === "vs_high_score" || mech === "vs_top_10") {
    return { kind: "vr", required: true };
  }
  if (isPriceIsRightPaintTemplate(input.paintTemplate)) {
    return { kind: "prior_day_vs", required: true };
  }
  return { kind: "none", required: false };
}

/** Build a status object from a classified need + fetched score count. */
export function buildVsDataStatus(input: {
  kind: TrainsVsDataStatusKind;
  required: boolean;
  scoreCount: number;
  scoreDate?: string;
}): TrainsVsDataStatus {
  const ready = !input.required || input.scoreCount > 0;
  return {
    required: input.required,
    ready,
    scoreCount: input.scoreCount,
    kind: input.kind,
    ...(input.scoreDate !== undefined ? { scoreDate: input.scoreDate } : {}),
  };
}
