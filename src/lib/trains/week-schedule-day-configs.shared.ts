import {
  parseConductorRule,
  parseVipRule,
  type ConductorRule,
  type VipRule,
} from "@/lib/trains/rules/catalog.shared";
import {
  weekRulesForPreset,
  weekdayKeyForDate,
} from "@/lib/trains/rules/presets.shared";
import { weekDatesInTrainWeek } from "@/lib/trains/train-week-calendar.shared";
import type { WeekTemplateType } from "@/lib/trains/types";

export const PROVISIONAL_DAY_CONFIG_ID_PREFIX = "preview-";

/** True when the day config is generated client-side / server preview, not persisted. */
export function isProvisionalDayConfig(id: string): boolean {
  return id.startsWith(PROVISIONAL_DAY_CONFIG_ID_PREFIX);
}

/** Muted styling for draft schedule cells (week strip + month grid). */
export function provisionalDayConfigClass(isProvisional: boolean): string {
  return isProvisional
    ? "opacity-60 ring-1 ring-dashed ring-inset ring-[#8b949e]/50"
    : "";
}

export type MergedWeekScheduleDayConfig = {
  id: string;
  date: string;
  conductorRule: ConductorRule | null;
  vipRule: VipRule | null;
  isOverride: boolean;
  sourceTemplateKey: string | null;
};

type DayConfigRow = {
  id: string;
  date: string;
  conductorRule?: unknown;
  vipRule?: unknown;
  sourceTemplateKey?: string | null;
  isOverride?: number | null;
};

function mapDayConfigRow(row: DayConfigRow): MergedWeekScheduleDayConfig {
  return {
    id: row.id,
    date: row.date,
    conductorRule: parseConductorRule(row.conductorRule),
    vipRule: parseVipRule(row.vipRule),
    isOverride: row.isOverride === 1,
    sourceTemplateKey: row.sourceTemplateKey ?? null,
  };
}

function provisionalDay(
  date: string,
  templateType: WeekTemplateType,
): MergedWeekScheduleDayConfig {
  const rules = weekRulesForPreset(templateType)[weekdayKeyForDate(date)];
  return {
    id: `${PROVISIONAL_DAY_CONFIG_ID_PREFIX}${date}`,
    date,
    conductorRule: rules.conductorRule,
    vipRule: rules.vipRule,
    isOverride: false,
    sourceTemplateKey: templateType,
  };
}

/** Seven train-week days from the preset when no DB rows exist; merge when partial. */
export function resolveWeekDisplayDayConfigs(
  weekStart: string,
  templateType: WeekTemplateType,
  dayConfigRows: DayConfigRow[],
): MergedWeekScheduleDayConfig[] {
  if (dayConfigRows.length > 0) {
    return buildWeekScheduleDayConfigs(weekStart, templateType, dayConfigRows);
  }
  return weekDatesInTrainWeek(weekStart).map((date) =>
    provisionalDay(date, templateType),
  );
}

/**
 * Always return seven train-week days.
 *
 * **A persisted row always wins**, override or not. Previously a row with
 * `is_override = 0` was overwritten by the week preset's generated rule, so
 * any baseline / import / first-persist path that left the flag at 0 showed
 * the preset instead of the rule actually stored for that day.
 */
export function buildWeekScheduleDayConfigs(
  weekStart: string,
  templateType: WeekTemplateType,
  dayConfigRows: DayConfigRow[],
): MergedWeekScheduleDayConfig[] {
  const byDate = new Map(
    dayConfigRows.map((row) => [row.date, mapDayConfigRow(row)]),
  );

  return weekDatesInTrainWeek(weekStart).map(
    (date) => byDate.get(date) ?? provisionalDay(date, templateType),
  );
}
