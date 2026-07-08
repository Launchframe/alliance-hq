/** Client-safe types for the member THP tracker API. */

export type ThpBreakdown = {
  heroLevel: number;
  decorationsAndBuildings: number;
  gear: number;
  exclusiveWeapons: number;
  heroTier: number;
  heroSkill: number;
  wallOfHonor: number;
};

export const THP_BREAKDOWN_KEYS: readonly (keyof ThpBreakdown)[] = [
  "heroLevel",
  "decorationsAndBuildings",
  "gear",
  "exclusiveWeapons",
  "heroTier",
  "heroSkill",
  "wallOfHonor",
];

export type MyThpEvent = {
  total: number;
  breakdown: ThpBreakdown | null;
  previousTotal: number | null;
  createdAt: string;
  source: string;
};

export type MyThpPercentile = { rank: number; reporterCount: number; percentile: number };

export type MyThpPercentileChange = {
  days: 30 | 90 | 180;
  percentileThen: number | null;
  percentileNow: number | null;
  delta: number | null;
};

export type MyThpPayload = {
  currentThp: number | null;
  breakdown: ThpBreakdown | null;
  updatedAt: string | null;
  commanderName: string | null;
  percentile: MyThpPercentile | null;
  percentileChange: MyThpPercentileChange[];
  events: MyThpEvent[];
  reporterCount: number;
};

export type MyThpPostStatus =
  | "set_thp"
  | "anomaly_confirm"
  | "anomaly_rejected"
  | "validation_error"
  | "ocr_confirm"
  | "error";

export type MyThpPostResponse = {
  status: MyThpPostStatus;
  message: string;
  newThp?: number;
  proposedThp?: number;
  proposedBreakdown?: ThpBreakdown | null;
};
