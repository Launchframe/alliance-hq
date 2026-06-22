import { paintTemplateFromConductorConfig } from "@/lib/trains/calendar-cell-styles.shared";
import { generateWeekDayConfigs } from "@/lib/trains/templates";
import type { WeekTemplateType } from "@/lib/trains/types";

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
      id: `preview-${generated.date}`,
      date: generated.date,
      conductorMechanism: generated.conductorMechanism,
      vipMechanism: generated.vipMechanism ?? null,
      vipConfig: generated.vipConfig ?? null,
      isOverride: false,
      paintTemplate: templateType,
    };
  });
}
