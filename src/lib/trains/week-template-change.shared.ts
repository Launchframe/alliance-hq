import { addCalendarDays } from "@/lib/trains/game-time";
import {
  DEFAULT_ALLIANCE_TRAIN_WEEK,
  weekDatesInTrainWeek,
  type AllianceTrainWeekConfig,
} from "@/lib/trains/train-week-calendar.shared";

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

/** VS economy pivot: Tue–Sun within the alliance train week (excludes closing Monday). */
export function pivotEconomyTargetDates(
  weekStart: string,
  weekEnd: string,
  trainWeekConfig: AllianceTrainWeekConfig = DEFAULT_ALLIANCE_TRAIN_WEEK,
): string[] {
  const dates = weekDatesInTrainWeek(weekStart, trainWeekConfig);
  const pivotDates =
    trainWeekConfig.trainWeekStartDow === 2
      ? dates.slice(0, 6)
      : dates.slice(1);
  return pivotDates.filter((date) => date <= weekEnd);
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
  trainWeekConfig?: AllianceTrainWeekConfig;
}): string[] {
  const trainWeekConfig = input.trainWeekConfig ?? DEFAULT_ALLIANCE_TRAIN_WEEK;
  const weekDates = weekDatesInTrainWeek(input.weekStart, trainWeekConfig);

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

  return weekDates.filter(
    (date) => date >= start && date <= input.weekEnd,
  );
}

/** Default include-today when today is the last train-week day and tomorrow is outside the week. */
export function defaultIncludeTodayForWeekTemplateChange(input: {
  weekStart: string;
  weekEnd: string;
  today: string;
}): boolean {
  return (
    input.today >= input.weekStart &&
    input.today <= input.weekEnd &&
    addCalendarDays(input.today, 1) > input.weekEnd
  );
}
