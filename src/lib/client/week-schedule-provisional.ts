import type { WeekSchedulePagePayload } from "@/lib/trains/load-dashboard";
import { addCalendarDays } from "@/lib/trains/game-time";
import { generateWeekDayConfigs } from "@/lib/trains/templates";
import type { WeekTemplateType } from "@/lib/trains/types";

export function buildProvisionalWeekPage(
  weekStart: string,
  templateType: WeekTemplateType | null = "vs_push_week",
): WeekSchedulePagePayload {
  const resolvedTemplate = templateType ?? "vs_push_week";
  const weekEnd = addCalendarDays(weekStart, 6);
  const dayConfigs = generateWeekDayConfigs(resolvedTemplate, weekStart).map((d) => ({
    id: `provisional-${d.date}`,
    date: d.date,
    conductorMechanism: d.conductorMechanism,
    vipMechanism: d.vipMechanism ?? null,
    vipConfig: d.vipConfig ?? null,
    isOverride: false,
    paintTemplate: resolvedTemplate,
  }));
  return {
    weekStart,
    weekEnd,
    templateType: resolvedTemplate,
    dayConfigs,
    weekRecords: [],
  };
}
