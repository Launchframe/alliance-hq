/**
 * Per-train-day score source stats for week tiles and Simple/Advanced panels.
 * Distinct from upload readiness: scoreCount = entries considered; eligibleCount =
 * members who can win under the day's rule.
 */

import {
  classifyVsDataNeed,
  type TrainsVsDataStatus,
  type TrainsVsDataStatusKind,
} from "@/lib/trains/vs-data-status.shared";
import type { VsScoreContext } from "@/lib/trains/vs-week-days.shared";
import { vsScoreContextForTrainDate } from "@/lib/trains/vs-week-days.shared";

export type TrainDayScoreStats = {
  kind: Exclude<TrainsVsDataStatusKind, "none">;
  /** Prior-day VS recorded date when kind is `prior_day_vs`. */
  scoreDate?: string;
  /** VS match day key when score date is Mon–Sat. */
  vsDayKey?: VsScoreContext["vsDayKey"];
  /** Members with a score row considered for gating. */
  scoreCount: number;
  /** Members eligible to win under this day's rule after filters. */
  eligibleCount: number;
  /** Scope N for top boards. */
  topN?: number;
  /** Whether scores are required before spinning (mirrors readiness). */
  required: boolean;
  ready: boolean;
};

/** Merge score stats into legacy vsDataStatus shape for dashboard consumers. */
export function trainDayScoreStatsToVsDataStatus(
  stats: TrainDayScoreStats,
): TrainsVsDataStatus {
  return {
    kind: stats.kind,
    required: stats.required,
    ready: stats.ready,
    scoreCount: stats.scoreCount,
    ...(stats.scoreDate !== undefined ? { scoreDate: stats.scoreDate } : {}),
    eligibleCount: stats.eligibleCount,
    ...(stats.vsDayKey !== undefined ? { vsDayKey: stats.vsDayKey } : {}),
    ...(stats.topN !== undefined ? { topN: stats.topN } : {}),
  };
}

/** Rebuild stats from an extended vsDataStatus when eligibleCount is present. */
export function trainDayScoreStatsFromVsDataStatus(
  status: TrainsVsDataStatus | null | undefined,
): TrainDayScoreStats | null {
  if (!status || status.kind === "none") return null;
  if (status.eligibleCount === undefined) return null;
  return buildTrainDayScoreStats({
    kind: status.kind,
    required: status.required,
    scoreCount: status.scoreCount,
    eligibleCount: status.eligibleCount,
    scoreDate: status.scoreDate,
    vsDayKey: status.vsDayKey,
    topN: status.topN,
  });
}

export function buildTrainDayScoreStats(input: {
  kind: Exclude<TrainsVsDataStatusKind, "none">;
  required: boolean;
  scoreCount: number;
  eligibleCount: number;
  scoreDate?: string;
  vsDayKey?: VsScoreContext["vsDayKey"];
  topN?: number;
}): TrainDayScoreStats {
  const ready = !input.required || input.scoreCount > 0;
  return {
    kind: input.kind,
    required: input.required,
    ready,
    scoreCount: input.scoreCount,
    eligibleCount: input.eligibleCount,
    ...(input.scoreDate !== undefined ? { scoreDate: input.scoreDate } : {}),
    ...(input.vsDayKey !== undefined ? { vsDayKey: input.vsDayKey } : {}),
    ...(input.topN !== undefined ? { topN: input.topN } : {}),
  };
}

/** Whether this day should show score stats in the UI. */
export function dayNeedsScoreStats(input: {
  conductorMechanism: string | null | undefined;
  paintTemplate?: string | null;
  trainDate?: string | null;
}): boolean {
  return classifyVsDataNeed(input).kind !== "none";
}

/** Score-source context for a train date (VS day name + scoreDate). */
export function scoreSourceContextForTrainDate(trainDate: string): {
  scoreDate: string;
  vsDayKey: VsScoreContext["vsDayKey"];
} {
  const ctx = vsScoreContextForTrainDate(trainDate);
  return { scoreDate: ctx.scoreDate, vsDayKey: ctx.vsDayKey };
}
