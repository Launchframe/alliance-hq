import type { MarkerIconPreset } from "@/lib/battle-plan/marker-icons.shared";

export const CAPTURE_POLICIES = ["peace", "war"] as const;
export type CapturePolicy = (typeof CAPTURE_POLICIES)[number];

export const TERRITORY_TYPES = ["stronghold", "city"] as const;
export type TerritoryType = (typeof TERRITORY_TYPES)[number];

export const CAPTURE_EVENT_STATUSES = [
  "scheduled",
  "completed",
  "cancelled",
] as const;
export type CaptureEventStatus = (typeof CAPTURE_EVENT_STATUSES)[number];

export const MAX_CAPTURES_PER_SERVER_DAY = 2;

export type SerializedBattlePlanSettings = {
  defaultCapturePolicy: CapturePolicy;
  planRevision: number;
  discordReportsEnabled: boolean;
  updatedAt: string;
};

export type SerializedCaptureEvent = {
  id: string;
  scheduledAt: string;
  serverCalendarDate: string;
  territoryType: TerritoryType;
  iconPreset: MarkerIconPreset | null;
  capturePolicy: CapturePolicy | null;
  effectiveCapturePolicy: CapturePolicy;
  notes: string | null;
  status: CaptureEventStatus;
  createdAt: string;
  updatedAt: string;
};

export type BattlePlanDashboardPayload = {
  settings: SerializedBattlePlanSettings;
  events: SerializedCaptureEvent[];
  canWrite: boolean;
  todayServerDate: string;
  effectiveSeasonKey?: string;
};
