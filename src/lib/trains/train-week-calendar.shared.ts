import {
  addCalendarDays,
  getServerDayOfWeek,
} from "@/lib/trains/game-time";

export type AllianceTrainWeekConfig = {
  /** 0=Sun … 6=Sat — first day of the alliance train week. */
  trainWeekStartDow: number;
};

export const DEFAULT_ALLIANCE_TRAIN_WEEK: AllianceTrainWeekConfig = {
  trainWeekStartDow: 2,
};

/** YYYY-MM-DD of the train week start containing dateStr. */
export function getTrainWeekStart(
  dateStr: string,
  config: AllianceTrainWeekConfig = DEFAULT_ALLIANCE_TRAIN_WEEK,
): string {
  const dow = getServerDayOfWeek(dateStr);
  const daysBack = (dow - config.trainWeekStartDow + 7) % 7;
  return addCalendarDays(dateStr, -daysBack);
}

/** Seven calendar dates beginning at train week start (index 0 = start DOW). */
export function weekDatesInTrainWeek(
  weekStart: string,
  _config: AllianceTrainWeekConfig = DEFAULT_ALLIANCE_TRAIN_WEEK,
): string[] {
  return Array.from({ length: 7 }, (_, i) => addCalendarDays(weekStart, i));
}

/** Index within the train week (0 = week start DOW … 6). Returns -1 if date is outside weekStart week. */
export function dayIndexInTrainWeek(
  date: string,
  weekStart: string,
  config: AllianceTrainWeekConfig = DEFAULT_ALLIANCE_TRAIN_WEEK,
): number {
  const expectedStart = getTrainWeekStart(date, config);
  if (expectedStart !== weekStart) return -1;
  return weekDatesInTrainWeek(weekStart, config).indexOf(date);
}

export function allianceTrainWeekFromRow(
  row: { trainWeekStartDow?: number | null },
): AllianceTrainWeekConfig {
  const dow = row.trainWeekStartDow;
  return {
    trainWeekStartDow:
      dow != null && dow >= 0 && dow <= 6
        ? dow
        : DEFAULT_ALLIANCE_TRAIN_WEEK.trainWeekStartDow,
  };
}
