import type { RegularEventKey } from "@/lib/regular-events/catalog.shared";

export type RegularEventScheduleKind =
  | "weekly"
  | "biweekly"
  | "once"
  | "interval_after_last";

/** UI repeats control (maps to schedule kinds; interval stays legacy/default-only). */
export type RegularEventRepeatCadence = "once" | "weekly" | "biweekly";

export type RegularEventWeeklySlot = {
  dow: number;
  timeSt: string;
};

export type RegularEventScheduleRuleInput = {
  eventKey: RegularEventKey;
  scheduleKind: RegularEventScheduleKind;
  weeklySlots?: RegularEventWeeklySlot[] | null;
  oneShotDates?: string[] | null;
  biweeklyPhaseMonday?: string | null;
  intervalDays?: number | null;
  anchorTimeSt?: string | null;
  announceLeadMinutes?: number;
  active?: boolean;
};

export type RegularEventOccurrenceSlot = {
  occurrenceDate: string;
  scheduledStartAt: Date;
};

export function cadenceFromScheduleKind(
  kind: string,
): RegularEventRepeatCadence {
  if (kind === "once") return "once";
  if (kind === "biweekly") return "biweekly";
  return "weekly";
}

export function scheduleKindFromCadence(
  cadence: RegularEventRepeatCadence,
): Exclude<RegularEventScheduleKind, "interval_after_last"> {
  return cadence;
}
