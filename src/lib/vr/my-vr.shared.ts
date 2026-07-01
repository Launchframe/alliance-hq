/** Client-safe types for the member VR tracker API. */

export type MyVrEvent = {
  baseVr: number;
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
  currentVr: number | null;
  updatedAt: string | null;
  commanderName: string | null;
  percentile: MyVrPercentile | null;
  reporterCount: number;
  events: MyVrEvent[];
};

export type MyVrPostStatus =
  | "set_vr"
  | "anomaly_confirm"
  | "anomaly_rejected"
  | "validation_error"
  | "error";

export type MyVrPostResponse = {
  status: MyVrPostStatus;
  message: string;
  newVr?: number;
  proposedVr?: number;
};
