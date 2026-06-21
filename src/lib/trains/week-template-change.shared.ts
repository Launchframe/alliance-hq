import { addCalendarDays, weekDatesFromMonday } from "@/lib/trains/game-time";

export function latestLockedDateInWeek(
  records: Array<{ date: string; lockedAt?: string | null }>,
  weekStart: string,
  weekEnd: string,
): string | null {
  let latest: string | null = null;

  for (const record of records) {
    if (!record.lockedAt) continue;
    if (record.date < weekStart || record.date > weekEnd) continue;
    if (latest == null || record.date > latest) {
      latest = record.date;
    }
  }

  return latest;
}

export function formatTrainScheduleDateLabel(date: string): string {
  const anchor = new Date(`${date}T12:00:00-02:00`);
  return anchor.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "Etc/GMT+2",
  });
}

/** Tue–Sun dates in the game week (Mon index 0 skipped). */
export function pivotEconomyTargetDates(
  weekStart: string,
  weekEnd: string,
): string[] {
  return weekDatesFromMonday(weekStart)
    .slice(1)
    .filter((date) => date <= weekEnd);
}

/**
 * Dates to paint when applying a template to the rest of the current week.
 * Locked days and days before the computed start are excluded.
 */
export function restOfWeekPaintDates(input: {
  weekStart: string;
  weekEnd: string;
  today: string;
  includeToday: boolean;
  lockedThroughDate: string | null;
}): string[] {
  let start = input.includeToday
    ? input.today
    : addCalendarDays(input.today, 1);

  if (input.lockedThroughDate && start <= input.lockedThroughDate) {
    start = addCalendarDays(input.lockedThroughDate, 1);
  }

  if (start < input.weekStart) {
    start = input.weekStart;
  }

  if (start > input.weekEnd) {
    return [];
  }

  return weekDatesFromMonday(input.weekStart).filter(
    (date) => date >= start && date <= input.weekEnd,
  );
}
