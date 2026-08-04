import { addCalendarDays, getServerDayOfWeek } from "@/lib/trains/game-time";
import { VS_WEEK_DAY_MESSAGE_KEYS } from "@/lib/trains/vs-week-days.shared";

export type VsMatchDayNumber = 1 | 2 | 3 | 4 | 5 | 6;

const VS_DAY_KEYS = VS_WEEK_DAY_MESSAGE_KEYS;

/** VS match day 1–6 for Mon–Sat; null on Sunday (rest). */
export function vsMatchDayNumberFromDate(dateStr: string): VsMatchDayNumber | null {
  const dow = getServerDayOfWeek(dateStr);
  if (dow === 0) return null;
  return dow as VsMatchDayNumber;
}

export function vsDayMessageKey(
  dayNumber: VsMatchDayNumber,
): (typeof VS_DAY_KEYS)[VsMatchDayNumber] {
  return VS_DAY_KEYS[dayNumber];
}

export const VS_MATCH_DAY_NUMBERS: VsMatchDayNumber[] = [1, 2, 3, 4, 5, 6];

/** Calculator UI uses Mon–Fri only (days 1–5). */
export const VS_CALCULATOR_DAY_NUMBERS = [1, 2, 3, 4, 5] as const;
export type VsCalculatorDayNumber = (typeof VS_CALCULATOR_DAY_NUMBERS)[number];

export function mondayOfVsWeekContaining(dateStr: string): string {
  const dow = getServerDayOfWeek(dateStr);
  const offset = dow === 0 ? -6 : 1 - dow;
  return addCalendarDays(dateStr, offset);
}

export function dateForVsMatchDayInWeek(
  weekMonday: string,
  dayNumber: VsMatchDayNumber,
): string {
  return addCalendarDays(weekMonday, dayNumber - 1);
}
