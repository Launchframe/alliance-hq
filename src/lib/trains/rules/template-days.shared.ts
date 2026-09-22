import { z } from "zod";

import {
  dayRulesSchema,
  type DayRules,
} from "@/lib/trains/rules/catalog.shared";
import {
  WEEKDAY_KEYS,
  weekdayKeyForDate,
  type TemplateWeekRules,
  type WeekdayKey,
} from "@/lib/trains/rules/presets.shared";
import {
  conductorRuleSourceDay,
  validateConductorRuleOnWeekday,
} from "@/lib/trains/rules/derive.shared";

export type { TemplateWeekRules, WeekdayKey };

const FREE_DAY: DayRules = { conductorRule: null, vipRule: null };

/** A template is exactly seven calendar-weekday slots, Mon–Sun. */
export const templateWeekRulesSchema = z.object({
  sun: dayRulesSchema,
  mon: dayRulesSchema,
  tue: dayRulesSchema,
  wed: dayRulesSchema,
  thu: dayRulesSchema,
  fri: dayRulesSchema,
  sat: dayRulesSchema,
});

/** Tolerant read of a stored `days` payload — unknown slots become free choice. */
export function parseTemplateWeekRules(value: unknown): TemplateWeekRules {
  const parsed = templateWeekRulesSchema.safeParse(value);
  if (parsed.success) return parsed.data;

  const partial = (value ?? {}) as Record<string, unknown>;
  const out = {} as TemplateWeekRules;
  for (const day of WEEKDAY_KEYS) {
    const slot = dayRulesSchema.safeParse(partial[day]);
    out[day] = slot.success ? slot.data : FREE_DAY;
  }
  return out;
}

/** Rules a template assigns to a calendar date. */
export function templateRulesForDate(
  days: TemplateWeekRules,
  date: string,
): DayRules {
  return days[weekdayKeyForDate(date)];
}

export type TemplateSlotWarning = {
  weekday: WeekdayKey;
  reason: "source_day_not_vs_day";
  /** Weekday the rule would read from (0=Sun … 6=Sat). */
  sourceDow: number;
};

/**
 * Advisory warnings for a template under one alliance's lead time.
 *
 * A VS-sourced rule needs its source day to be a VS match day; lead time
 * moves which slot that breaks. Warnings never block saving or applying — an
 * officer may knowingly paint the day and pick manually.
 */
export function validateTemplateWeekRules(
  days: TemplateWeekRules,
  leadDays = 0,
): TemplateSlotWarning[] {
  const warnings: TemplateSlotWarning[] = [];
  WEEKDAY_KEYS.forEach((weekday, dow) => {
    const validity = validateConductorRuleOnWeekday(
      days[weekday].conductorRule,
      dow,
      leadDays,
    );
    if (!validity.ok) {
      warnings.push({
        weekday,
        reason: validity.reason,
        sourceDow: validity.sourceDow,
      });
    }
  });
  return warnings;
}

export { conductorRuleSourceDay, WEEKDAY_KEYS };
