import "server-only";

import { addCalendarDays } from "@/lib/trains/game-time";
import { loadAllianceRow } from "@/lib/members/game-roster";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import {
  getWeekSchedule,
  listDayConfigsForWeek,
} from "@/lib/trains/repository";
import { presetRulesForDate } from "@/lib/trains/rules/presets.shared";
import {
  allianceTrainWeekFromRow,
  getTrainWeekStart,
} from "@/lib/trains/train-week-calendar.shared";
import {
  PROVISIONAL_DAY_CONFIG_ID_PREFIX,
  resolveWeekDisplayDayConfigs,
} from "@/lib/trains/week-schedule-day-configs.shared";
import type { DayConfigInput, WeekTemplateType } from "@/lib/trains/types";

export type ResolvedRollDayConfig = DayConfigInput & {
  dayConfigId: string | null;
};

async function trainWeekStartForAlliance(
  allianceId: string,
  date: string,
): Promise<string> {
  const row = await loadAllianceRow(allianceId);
  return getTrainWeekStart(date, allianceTrainWeekFromRow(row ?? {}));
}

export async function resolveAnchorTemplateType(
  allianceId: string,
  seasonKey: string,
): Promise<WeekTemplateType> {
  const today = getServerCalendarDate();
  const weekStart = await trainWeekStartForAlliance(allianceId, today);
  const anchorSchedule = await getWeekSchedule(
    allianceId,
    weekStart,
    seasonKey,
  );
  return (anchorSchedule?.templateType ?? "vs_push_week") as WeekTemplateType;
}

async function weekTemplateTypeForDate(
  allianceId: string,
  date: string,
  seasonKey: string,
): Promise<WeekTemplateType> {
  const weekStart = await trainWeekStartForAlliance(allianceId, date);
  const weekSchedule = await getWeekSchedule(allianceId, weekStart, seasonKey);
  const anchorTemplate = await resolveAnchorTemplateType(allianceId, seasonKey);
  return (weekSchedule?.templateType ?? anchorTemplate) as WeekTemplateType;
}

/**
 * Same merge as the week strip / dashboard: persisted rows plus preset fill
 * for gaps. Use for rolls, leaderboards, and score stats — not only raw
 * `getDayConfig` rows.
 */
export async function resolveDisplayMergedDayConfigForDate(
  allianceId: string,
  date: string,
  seasonKey: string,
): Promise<ResolvedRollDayConfig> {
  const weekStart = await trainWeekStartForAlliance(allianceId, date);
  const weekEnd = addCalendarDays(weekStart, 6);
  const templateType = await weekTemplateTypeForDate(
    allianceId,
    date,
    seasonKey,
  );
  const dayConfigRows = await listDayConfigsForWeek(
    allianceId,
    weekStart,
    weekEnd,
  );
  const merged = resolveWeekDisplayDayConfigs(
    weekStart,
    templateType,
    dayConfigRows,
  );
  const day = merged.find((row) => row.date === date);
  if (!day) {
    const rules = presetRulesForDate(templateType, date);
    return {
      date,
      conductorRule: rules.conductorRule,
      vipRule: rules.vipRule,
      sourceTemplateKey: templateType,
      dayConfigId: null,
    };
  }

  return {
    date: day.date,
    conductorRule: day.conductorRule,
    vipRule: day.vipRule,
    sourceTemplateKey: day.sourceTemplateKey,
    dayConfigId: day.id.startsWith(PROVISIONAL_DAY_CONFIG_ID_PREFIX)
      ? null
      : day.id,
  };
}

/** Match month/week schedule previews when a day has no persisted config row yet. */
export async function resolveRollDayConfig(
  allianceId: string,
  date: string,
  seasonKey: string,
): Promise<ResolvedRollDayConfig> {
  return resolveDisplayMergedDayConfigForDate(allianceId, date, seasonKey);
}
