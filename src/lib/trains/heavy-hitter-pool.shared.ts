import { getServerDayOfWeek } from "@/lib/trains/game-time";
import type { WeekTemplateType } from "@/lib/trains/types";

/** Saturday in The Price Is Freight week uses the heavy-hitter (max-ticket) lottery. */
export function isPriceIsRightHeavyHitterSaturday(
  paintTemplate: WeekTemplateType | null | undefined,
  date: string | null | undefined,
): boolean {
  if (paintTemplate !== "price_is_right" || !date) return false;
  return getServerDayOfWeek(date) === 6;
}
