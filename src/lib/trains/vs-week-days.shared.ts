import { addCalendarDays, getWeekStartMonday } from "@/lib/trains/game-time";
import { dayIndexInWeek } from "@/lib/trains/week-template-registry.shared";

/** VS match days Mon–Sat within a calendar week (Mon = day 1). */
export const VS_WEEK_DAY_MESSAGE_KEYS = {
  1: "radarTraining",
  2: "baseExpansion",
  3: "ageOfScience",
  4: "heroDay",
  5: "totalMobilization",
  6: "busterDay",
} as const;

export type VsWeekDayNumber = keyof typeof VS_WEEK_DAY_MESSAGE_KEYS;

export type VsScoreContext = {
  /** Calendar date whose VS scores apply (train date minus one day). */
  scoreDate: string;
  vsDayNumber: VsWeekDayNumber | null;
  vsDayKey: (typeof VS_WEEK_DAY_MESSAGE_KEYS)[VsWeekDayNumber] | null;
};

export function vsDayNumberFromWeekdayIndex(
  dayIndex: number,
): VsWeekDayNumber | null {
  if (dayIndex < 0 || dayIndex > 5) return null;
  return (dayIndex + 1) as VsWeekDayNumber;
}

export function vsScoreContextForTrainDate(trainDate: string): VsScoreContext {
  const scoreDate = addCalendarDays(trainDate, -1);
  const weekStart = getWeekStartMonday(scoreDate);
  const dayIndex = dayIndexInWeek(scoreDate, weekStart);
  const vsDayNumber = vsDayNumberFromWeekdayIndex(dayIndex);
  const vsDayKey = vsDayNumber ? VS_WEEK_DAY_MESSAGE_KEYS[vsDayNumber] : null;
  return { scoreDate, vsDayNumber, vsDayKey };
}

export function vsScoreReferenceDate(trainDate: string): string {
  return addCalendarDays(trainDate, -1);
}
