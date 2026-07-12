/** Client-safe types for the member kills tracker API. */

export type MyKillsEvent = {
  total: number;
  previousTotal: number | null;
  createdAt: string;
  source: string;
};

export type MyKillsPercentile = {
  rank: number;
  reporterCount: number;
  percentile: number;
};

export type MyKillsPercentileChange = {
  days: 30 | 90 | 180;
  percentileThen: number | null;
  percentileNow: number | null;
  delta: number | null;
};

export type MyKillsPayload = {
  currentKills: number | null;
  updatedAt: string | null;
  commanderName: string | null;
  percentile: MyKillsPercentile | null;
  percentileChange: MyKillsPercentileChange[];
  events: MyKillsEvent[];
  reporterCount: number;
};

export type MyKillsPostStatus =
  | "set_kills"
  | "anomaly_confirm"
  | "anomaly_rejected"
  | "validation_error"
  | "error";

export type MyKillsPostResponse = {
  status: MyKillsPostStatus;
  message: string;
  newKills?: number;
  proposedKills?: number;
};
