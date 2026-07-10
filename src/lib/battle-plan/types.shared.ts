export const BATTLE_PLAN_MARKER_NUMBERS = [1, 2, 3, 4, 5] as const;
export type BattlePlanMarkerNumber =
  (typeof BATTLE_PLAN_MARKER_NUMBERS)[number];

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

export type SerializedBattlePlanMarker = {
  id: string;
  markerNumber: BattlePlanMarkerNumber;
  label: string | null;
  colorHex: string;
  updatedAt: string;
};

export type SerializedCaptureEvent = {
  id: string;
  scheduledAt: string;
  serverCalendarDate: string;
  territoryType: TerritoryType;
  markerNumber: BattlePlanMarkerNumber;
  capturePolicy: CapturePolicy | null;
  effectiveCapturePolicy: CapturePolicy;
  notes: string | null;
  status: CaptureEventStatus;
  createdAt: string;
  updatedAt: string;
};

export type BattlePlanDashboardPayload = {
  settings: SerializedBattlePlanSettings;
  markers: SerializedBattlePlanMarker[];
  events: SerializedCaptureEvent[];
  canWrite: boolean;
  todayServerDate: string;
};
