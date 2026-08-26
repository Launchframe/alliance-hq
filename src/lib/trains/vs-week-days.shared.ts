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
  /** Calendar date whose VS scores apply (trainDate − 1 − leadDays). */
  scoreDate: string;
  vsDayNumber: VsWeekDayNumber | null;
  vsDayKey: (typeof VS_WEEK_DAY_MESSAGE_KEYS)[VsWeekDayNumber] | null;
};

/** Clamp alliance lead-time days to the API range. */
export function clampTrainConductorLeadTimeDays(days: number): number {
  if (!Number.isFinite(days)) return 0;
  return Math.max(0, Math.min(7, Math.trunc(days)));
}

export function vsDayNumberFromWeekdayIndex(
  dayIndex: number,
): VsWeekDayNumber | null {
  if (dayIndex < 0 || dayIndex > 5) return null;
  return (dayIndex + 1) as VsWeekDayNumber;
}

/**
 * Score reference date for a train day.
 * Default leadDays=0 → T−1; leadDays=1 → T−2 (e.g. Mon train uses Sat scores).
 */
export function vsScoreReferenceDate(
  trainDate: string,
  leadDays = 0,
): string {
  const lead = clampTrainConductorLeadTimeDays(leadDays);
  return addCalendarDays(trainDate, -1 - lead);
}

export function vsScoreContextForTrainDate(
  trainDate: string,
  leadDays = 0,
): VsScoreContext {
  const scoreDate = vsScoreReferenceDate(trainDate, leadDays);
  const weekStart = getWeekStartMonday(scoreDate);
  const dayIndex = dayIndexInWeek(scoreDate, weekStart);
  const vsDayNumber = vsDayNumberFromWeekdayIndex(dayIndex);
  const vsDayKey = vsDayNumber ? VS_WEEK_DAY_MESSAGE_KEYS[vsDayNumber] : null;
  return { scoreDate, vsDayNumber, vsDayKey };
}
