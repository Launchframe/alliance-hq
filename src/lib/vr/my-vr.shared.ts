/** Client-safe types for the member VR tracker API. */

import type { VrProgressChartPayload } from "@/lib/vr/vr-progress-chart.shared";

export type MyVrEvent = {
  baseVr: number;
  instituteLevel: number | null;
  previousBaseVr: number | null;
  createdAt: string;
  source: string;
};

export type MyVrPercentile = {
  rank: number;
  reporterCount: number;
  percentile: number;
};

export type MyVrPayload = {
  seasonKey: string;
  isPostSeason: boolean;
  vrUpdatesLocked: boolean;
  vrSandboxActive: boolean;
  priorSeason: string | null;
  seasonMaxVr: number | null;
  currentVr: number | null;
  instituteLevel: number | null;
  effectiveVr: number | null;
  weeklyPassBoost: number;
  /** True when the Commander's weekly pass is active (+250 effective VR). */
  weeklyPassActive: boolean | null;
  updatedAt: string | null;
  commanderName: string | null;
  percentile: MyVrPercentile | null;
  reporterCount: number;
  events: MyVrEvent[];
  progressChart: VrProgressChartPayload | null;
};

export type MyVrPostStatus =
  | "set_vr"
  | "anomaly_confirm"
  | "anomaly_rejected"
  | "validation_error"
  | "season_locked"
  | "error";

export type MyVrPostResponse = {
  status: MyVrPostStatus;
  message: string;
  newVr?: number;
  newInstituteLevel?: number | null;
  proposedVr?: number;
  proposedInstituteLevel?: number | null;
};
