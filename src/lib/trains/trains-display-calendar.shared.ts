import {
  addCalendarDays,
  getServerDayOfWeek,
  getWeekStartMonday,
  monthEndFromKey,
  monthStartFromKey,
} from "@/lib/trains/game-time";

/** Calendar week start options for trains month grids (0 = Sunday, 1 = Monday). */
export const TRAINS_DISPLAY_WEEK_STARTS = {
  sunday: 0,
  monday: 1,
} as const;

export type TrainsDisplayWeekStartDow =
  (typeof TRAINS_DISPLAY_WEEK_STARTS)[keyof typeof TRAINS_DISPLAY_WEEK_STARTS];

export const DEFAULT_TRAINS_DISPLAY_WEEK_START_DOW: TrainsDisplayWeekStartDow =
  TRAINS_DISPLAY_WEEK_STARTS.sunday;

export function normalizeDisplayWeekStartDow(
  value: unknown,
): TrainsDisplayWeekStartDow {
  const parsed = typeof value === "number" ? value : Number(value);
  if (parsed === TRAINS_DISPLAY_WEEK_STARTS.monday) {
    return TRAINS_DISPLAY_WEEK_STARTS.monday;
  }
  return DEFAULT_TRAINS_DISPLAY_WEEK_START_DOW;
}

export type MonthGridCell = {
  date: string;
  inMonth: boolean;
};

function weekStartForDisplay(
  dateStr: string,
  displayWeekStartDow: TrainsDisplayWeekStartDow,
): string {
  if (displayWeekStartDow === TRAINS_DISPLAY_WEEK_STARTS.monday) {
    return getWeekStartMonday(dateStr);
  }
  const dow = getServerDayOfWeek(dateStr);
  return addCalendarDays(dateStr, -dow);
}

/** Build a 6-week grid anchored to the user's preferred week start. */
export function buildMonthGrid(
  monthKey: string,
  displayWeekStartDow: TrainsDisplayWeekStartDow = DEFAULT_TRAINS_DISPLAY_WEEK_START_DOW,
): MonthGridCell[] {
  const monthStart = monthStartFromKey(monthKey);
  const monthEnd = monthEndFromKey(monthKey);
  const gridStart = weekStartForDisplay(monthStart, displayWeekStartDow);

  return Array.from({ length: 42 }, (_, i) => {
    const date = addCalendarDays(gridStart, i);
    return {
      date,
      inMonth: date >= monthStart && date <= monthEnd,
    };
  });
}
