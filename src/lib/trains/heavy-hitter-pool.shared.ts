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
 * True when conductor rolls / odds UI should use the with-replacement Price Is
 * Freight path (weekday raffle or Saturday heavy-hitter), not depleting pools.
 *
 * Composite PIR weeks paint Saturday as `takedown_week`; that segment must stay
 * on the with-replacement path.
 */
export function usesPriceIsFreightConductorRoll(
  paintTemplate: WeekTemplateType | string | null | undefined,
): boolean {
  return (
    isPriceIsRightPaintTemplate(paintTemplate) ||
    paintTemplate === "takedown_week"
  );
}

/** Economy / Price Is Freight weeks use prior-day VS for conductor pools. */
export function paintTemplateUsesPriorDayVs(
  paintTemplate: WeekTemplateType | string | null | undefined,
): boolean {
  return paintTemplate === "economy_week" || isPriceIsRightPaintTemplate(paintTemplate);
}

/**
 * Saturday heavy-hitter (max-ticket) draw for The Price Is Freight.
 *
 * Legacy whole-week `price_is_right` paint uses weekday + Saturday-on-date.
 * New composite schedules paint Saturday as `takedown_week` instead — that
 * segment is always the with-replacement heavy-hitter lottery.
 */
export function isPriceIsRightHeavyHitterSaturday(
  paintTemplate: WeekTemplateType | null | undefined,
  date: string | null | undefined,
): boolean {
  if (paintTemplate === "takedown_week") return true;
  if (paintTemplate !== "price_is_right" || !date) return false;
  return getServerDayOfWeek(date) === 6;
}
