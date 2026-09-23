import type { WeekSchedulePagePayload } from "@/lib/trains/load-dashboard";
import { addCalendarDays } from "@/lib/trains/game-time";
import {
  templateRulesForDate,
  type TemplateWeekRules,
} from "@/lib/trains/rules/template-days.shared";
import { weekDatesInTrainWeek } from "@/lib/trains/train-week-calendar.shared";

/**
 * Seven preview days for a week no schedule row exists for.
 *
 * With no template the days are free choice, not an invented preset — the
 * officer has not chosen anything yet and the preview should say so.
 */
export function buildProvisionalWeekPage(
  weekStart: string,
  template: { id: string; days: TemplateWeekRules } | null = null,
): WeekSchedulePagePayload {
  return {
    weekStart,
    weekEnd: addCalendarDays(weekStart, 6),
    templateId: template?.id ?? null,
    dayConfigs: weekDatesInTrainWeek(weekStart).map((date) => {
      const rules = template
        ? templateRulesForDate(template.days, date)
        : { conductorRule: null, vipRule: null };
      return {
        id: `provisional-${date}`,
        date,
        conductorRule: rules.conductorRule,
        vipRule: rules.vipRule,
        isOverride: false,
        sourceTemplateId: template?.id ?? null,
      };
    }),
    weekRecords: [],
    dayScoreStats: {},
  };
}
