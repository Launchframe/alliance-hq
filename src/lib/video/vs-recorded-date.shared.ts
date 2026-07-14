import {
  addCalendarDays,
  getServerCalendarDate,
  getServerDayOfWeek,
} from "@/lib/trains/game-time";
import type { VsWeekDayNumber } from "@/lib/trains/vs-week-days.shared";

/** Upload-review VS day name keys (distinct from trains.vsWeekDays wording). */
export const VS_PERFORMANCE_DAY_MESSAGE_KEYS = {
  1: "radarTraining",
  2: "baseExpansion",
  3: "ageOfScience",
  4: "trainHeroes",
  5: "totalMobilization",
  6: "enemyBuster",
} as const;

export type VsPerformanceDayKey =
  (typeof VS_PERFORMANCE_DAY_MESSAGE_KEYS)[VsWeekDayNumber];

export type VsPerformanceDayMeta = {
  recordedDate: string;
  vsDayNumber: VsWeekDayNumber;
  vsDayKey: VsPerformanceDayKey;
};

/** Mon–Sat are VS match days; Sunday is never valid. */
export function isValidVsPerformanceRecordedDate(recordedDate: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(recordedDate.trim())) return false;
  return getServerDayOfWeek(recordedDate.trim()) !== 0;
}

/**
 * Calendar weekday → VS day number (Mon = 1 … Sat = 6).
 * Sunday yields null.
 */
export function vsPerformanceDayNumberForDate(
  recordedDate: string,
): VsWeekDayNumber | null {
  const dow = getServerDayOfWeek(recordedDate.trim());
  if (dow < 1 || dow > 6) return null;
  return dow as VsWeekDayNumber;
}

export function vsPerformanceDayMetaForDate(
  recordedDate: string,
): VsPerformanceDayMeta | null {
  const vsDayNumber = vsPerformanceDayNumberForDate(recordedDate);
  if (vsDayNumber == null) return null;
  return {
    recordedDate: recordedDate.trim().slice(0, 10),
    vsDayNumber,
    vsDayKey: VS_PERFORMANCE_DAY_MESSAGE_KEYS[vsDayNumber],
  };
}

/** Nearest prior valid VS day (never Sunday). Same day when already valid. */
export function nearestValidVsPerformanceDate(
  recordedDate: string,
): string {
  let cursor = recordedDate.trim().slice(0, 10);
  for (let i = 0; i < 7; i++) {
    if (isValidVsPerformanceRecordedDate(cursor)) return cursor;
    cursor = addCalendarDays(cursor, -1);
  }
  return cursor;
}

/**
 * Recent Mon–Sat dates for the VS recorded-date selector (newest first).
 * Always includes `includeDate` when it is a valid VS day.
 */
export function listRecentVsPerformanceDates(options?: {
  now?: Date;
  daysBack?: number;
  includeDate?: string | null;
}): string[] {
  const daysBack = options?.daysBack ?? 28;
  const today = getServerCalendarDate(options?.now);
  const dates: string[] = [];
  for (let i = 0; i <= daysBack; i++) {
    const date = addCalendarDays(today, -i);
    if (isValidVsPerformanceRecordedDate(date)) {
      dates.push(date);
    }
  }
  const include = options?.includeDate?.trim().slice(0, 10);
  if (
    include &&
    isValidVsPerformanceRecordedDate(include) &&
    !dates.includes(include)
  ) {
    dates.push(include);
    dates.sort((a, b) => b.localeCompare(a));
  }
  return dates;
}
