export const TIME_OFF_AVAILABILITIES = [
  "full_away",
  "limited",
  "minimums",
  "hit_and_miss",
] as const;

export type TimeOffAvailability = (typeof TIME_OFF_AVAILABILITIES)[number];

export const TIME_OFF_ENTRY_KINDS = [
  "planned",
  "officer_marked",
  "unexpected",
] as const;

export type TimeOffEntryKind = (typeof TIME_OFF_ENTRY_KINDS)[number];

export const TIME_OFF_SOURCES = ["discord", "web", "officer", "ashed"] as const;

export type TimeOffSource = (typeof TIME_OFF_SOURCES)[number];

export type SerializedTimeOffEntry = {
  id: string;
  ashedMemberId: string;
  memberName: string;
  startDate: string;
  endDate: string;
  notes: string | null;
  availability: TimeOffAvailability;
  entryKind: TimeOffEntryKind;
  source: TimeOffSource;
  version: number;
  globalAbsence: boolean;
  activityScope: "vs" | "donation" | "all";
  syncStatus: import("./excused-sync.shared").TimeOffSyncStatus;
  lastSyncedAt: string | null;
  noticeVerified: boolean;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TimeOffCalendarPayload = {
  todayServerDate: string;
  monthKey: string;
  entries: SerializedTimeOffEntry[];
  canWrite: boolean;
  canManageOthers: boolean;
  linkedCommanderIds: string[];
  commanders: Array<{ id: string; name: string }>;
  ownEntries: SerializedTimeOffEntry[];
  ownEntriesPage: number;
  ownEntriesHaveMore: boolean;
  history: boolean;
  ashedSyncEnabled: boolean;
  unexpectedReport?: {
    unexpected: SerializedTimeOffEntry[];
    unannounced: Array<{ ashedMemberId: string; memberName: string }>;
  };
};
