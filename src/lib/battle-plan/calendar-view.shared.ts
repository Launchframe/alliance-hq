import { addCalendarDays } from "@/lib/trains/game-time";

export const DAILY_CALENDAR_VISIBLE_DAYS = 3;

export function buildDailyGrid(
  anchorDate: string,
  dayCount = DAILY_CALENDAR_VISIBLE_DAYS,
): Array<{ date: string }> {
  return Array.from({ length: dayCount }, (_, index) => ({
    date: addCalendarDays(anchorDate, index),
  }));
}

export function formatDailyRangeLabel(
  anchorDate: string,
  dayCount = DAILY_CALENDAR_VISIBLE_DAYS,
): string {
  const endDate = addCalendarDays(anchorDate, dayCount - 1);
  return `${anchorDate} – ${endDate}`;
}
