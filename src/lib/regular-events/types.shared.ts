import type { RegularEventKey } from "@/lib/regular-events/catalog.shared";

export type RegularEventScheduleKind = "weekly" | "interval_after_last";

export type RegularEventWeeklySlot = {
  dow: number;
  timeSt: string;
};

export type RegularEventScheduleRuleInput = {
  eventKey: RegularEventKey;
  scheduleKind: RegularEventScheduleKind;
  weeklySlots?: RegularEventWeeklySlot[] | null;
  intervalDays?: number | null;
  anchorTimeSt?: string | null;
  announceLeadMinutes?: number;
  active?: boolean;
};

export type RegularEventOccurrenceSlot = {
  occurrenceDate: string;
  scheduledStartAt: Date;
};
