import {
  addCalendarDays,
  getServerCalendarDate,
  getServerDayOfWeek,
  getWeekStartMonday,
} from "@/lib/trains/game-time";

/** Server-time day of week: Fri = pre, Sat = fight, Sun = post. */
export type BusterDayWizardPhase =
  | "pre_snapshot"
  | "in_progress"
  | "post_snapshot"
  | "idle";

export type BusterDayWeekDates = {
  vsWeekMonday: string;
  friday: string;
  saturday: string;
  sunday: string;
};

export function busterDayWeekDates(vsWeekMonday: string): BusterDayWeekDates {
  return {
    vsWeekMonday,
    friday: addCalendarDays(vsWeekMonday, 4),
    saturday: addCalendarDays(vsWeekMonday, 5),
    sunday: addCalendarDays(vsWeekMonday, 6),
  };
}

/** Resolve the VS week Monday for a server calendar date. */
export function busterDayWeekMondayForDate(serverDate: string): string {
  return getWeekStartMonday(serverDate);
}

/**
 * Wizard phase from Server Time day-of-week.
 * Fri → pre uploads; Sat → wait; Sun → post uploads; Mon–Thu → idle.
 */
export function resolveBusterDayWizardPhase(
  serverDate: string = getServerCalendarDate(),
): BusterDayWizardPhase {
  const dow = getServerDayOfWeek(serverDate);
  if (dow === 5) return "pre_snapshot";
  if (dow === 6) return "in_progress";
  if (dow === 0) return "post_snapshot";
  return "idle";
}

export function isBusterDaySnapshotComplete(input: {
  rosterJobId: string | null | undefined;
  killsJobId: string | null | undefined;
}): boolean {
  return Boolean(input.rosterJobId && input.killsJobId);
}

export type SerializedBusterDayReport = {
  id: string;
  allianceId: string;
  vsWeekMonday: string;
  preSnapshotDate: string | null;
  preRosterJobId: string | null;
  preKillsJobId: string | null;
  preCompletedAt: string | null;
  postSnapshotDate: string | null;
  postRosterJobId: string | null;
  postKillsJobId: string | null;
  postCompletedAt: string | null;
  preReminderSentAt: string | null;
  postReminderSentAt: string | null;
  createdAt: string;
  updatedAt: string;
  preComplete: boolean;
  postComplete: boolean;
};
