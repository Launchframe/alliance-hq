import { addCalendarDays } from "@/lib/trains/game-time";
import type { DayConfigInput, WeekTemplateType } from "@/lib/trains/types";
import {
  presetRulesForDate,
  weekRulesForPreset,
  weekdayKeyForDate,
} from "@/lib/trains/rules/presets.shared";
import { weekDatesInTrainWeek } from "@/lib/trains/train-week-calendar.shared";

/**
 * Week presets → per-day rules.
 *
 * A preset assigns a rule to each **calendar weekday**, so resolving one day
 * is a direct lookup. The previous implementation built a whole week and then
 * picked the requested date out of it, which is why painting a "day rule"
 * like `vs_push_weekdays` onto a single day silently applied a day-of-week
 * table instead of one rule.
 */

export function dayConfigForPresetDate(
  templateType: WeekTemplateType,
  date: string,
): DayConfigInput {
  const rules = presetRulesForDate(templateType, date);
  return {
    date,
    conductorRule: rules.conductorRule,
    vipRule: rules.vipRule,
    sourceTemplateId: templateType,
  };
}

/** Seven day configs for the alliance's train week, in calendar order. */
export function weekDayConfigsForPreset(
  templateType: WeekTemplateType,
  weekStart: string,
): DayConfigInput[] {
  const week = weekRulesForPreset(templateType);
  return weekDatesInTrainWeek(weekStart).map((date) => {
    const rules = week[weekdayKeyForDate(date)];
    return {
      date,
      conductorRule: rules.conductorRule,
      vipRule: rules.vipRule,
      sourceTemplateId: templateType,
    };
  });
}

export { addCalendarDays };
