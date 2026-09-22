import type { WeekSchedulePagePayload } from "@/lib/trains/load-dashboard";
import { addCalendarDays } from "@/lib/trains/game-time";
import { weekDayConfigsForPreset } from "@/lib/trains/templates";
import type { WeekTemplateType } from "@/lib/trains/types";

export function buildProvisionalWeekPage(
  weekStart: string,
  templateType: WeekTemplateType | null = "vs_push_week",
): WeekSchedulePagePayload {
  const resolvedTemplate = templateType ?? "vs_push_week";
  const weekEnd = addCalendarDays(weekStart, 6);
  const dayConfigs = weekDayConfigsForPreset(resolvedTemplate, weekStart).map(
    (day) => ({
      id: `provisional-${day.date}`,
      date: day.date,
      conductorRule: day.conductorRule,
      vipRule: day.vipRule,
      isOverride: false,
      sourceTemplateKey: resolvedTemplate,
    }),
  );
  return {
    weekStart,
    weekEnd,
    templateType: resolvedTemplate,
    dayConfigs,
    weekRecords: [],
    dayScoreStats: {},
  };
}
