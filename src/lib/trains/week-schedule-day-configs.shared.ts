import { paintTemplateFromConductorConfig } from "@/lib/trains/calendar-cell-styles.shared";
import { generateWeekDayConfigs } from "@/lib/trains/templates";
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
  conductorMechanism: string;
  vipMechanism: string | null;
  vipConfig: unknown;
  isOverride: boolean;
  paintTemplate: WeekTemplateType | null;
};

type DayConfigRow = {
  id: string;
  date: string;
  conductorMechanism: string;
  conductorConfig?: unknown;
  vipMechanism: string | null;
  vipConfig: unknown;
  isOverride?: number | null;
};

function mapDayConfigRow(row: DayConfigRow): MergedWeekScheduleDayConfig {
  return {
    id: row.id,
    date: row.date,
    conductorMechanism: row.conductorMechanism,
    vipMechanism: row.vipMechanism,
    vipConfig: row.vipConfig,
    isOverride: row.isOverride === 1,
    paintTemplate: paintTemplateFromConductorConfig(row.conductorConfig),
  };
}

/** Seven train-week days from template when no DB rows exist; merge when partial rows exist. */
export function resolveWeekDisplayDayConfigs(
  weekStart: string,
  templateType: WeekTemplateType,
  dayConfigRows: DayConfigRow[],
): MergedWeekScheduleDayConfig[] {
  if (dayConfigRows.length > 0) {
    return buildWeekScheduleDayConfigs(weekStart, templateType, dayConfigRows);
  }

  return generateWeekDayConfigs(templateType, weekStart).map((generated) => ({
    id: `${PROVISIONAL_DAY_CONFIG_ID_PREFIX}${generated.date}`,
    date: generated.date,
    conductorMechanism: generated.conductorMechanism,
    vipMechanism: generated.vipMechanism ?? null,
    vipConfig: generated.vipConfig ?? null,
    isOverride: false,
    paintTemplate: templateType,
  }));
}

/** Always return seven train-week days — DB rows win; template fills gaps. */
export function buildWeekScheduleDayConfigs(
  weekStart: string,
  templateType: WeekTemplateType,
  dayConfigRows: DayConfigRow[],
): MergedWeekScheduleDayConfig[] {
  const byDate = new Map(
    dayConfigRows.map((row) => [row.date, mapDayConfigRow(row)]),
  );

  return generateWeekDayConfigs(templateType, weekStart).map((generated) => {
    const existing = byDate.get(generated.date);
    if (existing) return existing;

    return {
      id: `${PROVISIONAL_DAY_CONFIG_ID_PREFIX}${generated.date}`,
      date: generated.date,
      conductorMechanism: generated.conductorMechanism,
      vipMechanism: generated.vipMechanism ?? null,
      vipConfig: generated.vipConfig ?? null,
      isOverride: false,
      paintTemplate: templateType,
    };
  });
}
