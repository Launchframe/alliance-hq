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

/** Daily match days (Mon–Sat) vs weekly totals (Sunday upload). */
export type VsScorePeriod = "daily" | "weekly";

/** Mon–Sat are VS match days; Sunday is only valid for weekly totals. */
export function isValidVsPerformanceRecordedDate(
  recordedDate: string,
  period: VsScorePeriod = "daily",
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(recordedDate.trim())) return false;
  const dow = getServerDayOfWeek(recordedDate.trim());
  if (period === "weekly") {
    return dow === 0;
  }
  return dow !== 0;
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

/** Nearest prior valid date for the period. Same day when already valid. */
export function nearestValidVsPerformanceDate(
  recordedDate: string,
  period: VsScorePeriod = "daily",
): string {
  let cursor = recordedDate.trim().slice(0, 10);
  for (let i = 0; i < 7; i++) {
    if (isValidVsPerformanceRecordedDate(cursor, period)) return cursor;
    cursor = addCalendarDays(cursor, -1);
  }
  return cursor;
}

/**
 * Recent dates for the VS recorded-date selector (newest first).
 * Daily: Mon–Sat. Weekly: Sundays only (HQ assumes weekly totals upload on Sunday).
 */
export function listRecentVsPerformanceDates(options?: {
  now?: Date;
  daysBack?: number;
  includeDate?: string | null;
  period?: VsScorePeriod;
}): string[] {
  const period = options?.period ?? "daily";
  const daysBack = options?.daysBack ?? 28;
  const today = getServerCalendarDate(options?.now);
  const dates: string[] = [];
  for (let i = 0; i <= daysBack; i++) {
    const date = addCalendarDays(today, -i);
    if (isValidVsPerformanceRecordedDate(date, period)) {
      dates.push(date);
    }
  }
  const include = options?.includeDate?.trim().slice(0, 10);
  if (
    include &&
    isValidVsPerformanceRecordedDate(include, period) &&
    !dates.includes(include)
  ) {
    dates.push(include);
    dates.sort((a, b) => b.localeCompare(a));
  }
  return dates;
}
