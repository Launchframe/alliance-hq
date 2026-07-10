import { addCalendarDays } from "@/lib/trains/game-time";

export type BattlePlanCalendarView = "day" | "month";

export const BATTLE_PLAN_CALENDAR_VIEW_STORAGE_KEY =
  "alliance-hq-battle-plan-calendar-view-v1";

export const DAILY_CALENDAR_VISIBLE_DAYS = 3;

/** Tailwind `md` breakpoint — tablet and up. */
export const BATTLE_PLAN_CALENDAR_TABLET_MQ = "(min-width: 768px)";

const DEFAULT_VIEW: BattlePlanCalendarView = "day";

export function isBattlePlanCalendarView(
  value: string,
): value is BattlePlanCalendarView {
  return value === "day" || value === "month";
}

export function readStoredBattlePlanCalendarView(): BattlePlanCalendarView {
  if (typeof window === "undefined") {
    return DEFAULT_VIEW;
  }
  try {
    const raw = window.localStorage.getItem(BATTLE_PLAN_CALENDAR_VIEW_STORAGE_KEY);
    if (raw === "week") {
      return "day";
    }
    if (raw && isBattlePlanCalendarView(raw)) {
      return raw;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_VIEW;
}

export function writeStoredBattlePlanCalendarView(
  view: BattlePlanCalendarView,
): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(BATTLE_PLAN_CALENDAR_VIEW_STORAGE_KEY, view);
  } catch {
    /* ignore quota / private mode */
  }
}

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
