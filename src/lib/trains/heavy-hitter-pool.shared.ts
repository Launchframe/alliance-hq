import { getServerDayOfWeek } from "@/lib/trains/game-time";
import type { WeekTemplateType } from "@/lib/trains/types";

/** True for The Price Is Freight weekday raffle paint (and legacy whole-week paint). */
export function isPriceIsRightPaintTemplate(
  paintTemplate: WeekTemplateType | string | null | undefined,
): boolean {
  return (
    paintTemplate === "price_is_right" ||
    paintTemplate === "price_is_right_weekdays"
  );
}

/**
 * Saturday in a legacy whole-week `price_is_right` paint uses the heavy-hitter
 * lottery. New schedules paint Saturday as `takedown_week` instead.
 */
export function isPriceIsRightHeavyHitterSaturday(
  paintTemplate: WeekTemplateType | null | undefined,
  date: string | null | undefined,
): boolean {
  if (paintTemplate !== "price_is_right" || !date) return false;
  return getServerDayOfWeek(date) === 6;
}
