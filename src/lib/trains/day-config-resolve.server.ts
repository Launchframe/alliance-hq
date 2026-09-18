import "server-only";

import { addCalendarDays } from "@/lib/trains/game-time";
import { loadAllianceRow } from "@/lib/members/game-roster";
import { listDayConfigsForWeek } from "@/lib/trains/repository";
import { resolveWeekFillTemplateResolver } from "@/lib/trains/rules/week-template-resolve.server";
import { templateRulesForDate } from "@/lib/trains/rules/template-days.shared";
import {
  allianceTrainWeekFromRow,
  getTrainWeekStart,
  weekDatesInTrainWeek,
} from "@/lib/trains/train-week-calendar.shared";
import {
  PROVISIONAL_DAY_CONFIG_ID_PREFIX,
  resolveWeekDisplayDayConfigs,
} from "@/lib/trains/week-schedule-day-configs.shared";
import type { DayConfigInput } from "@/lib/trains/types";

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
  const templateForDate = await resolveWeekFillTemplateResolver(
    allianceId,
    [...weekDatesInTrainWeek(weekStart), date],
    seasonKey,
  );
  const dayConfigRows = await listDayConfigsForWeek(
    allianceId,
    weekStart,
    weekEnd,
  );
  const merged = resolveWeekDisplayDayConfigs(
    weekStart,
    templateForDate,
    dayConfigRows,
  );
  const day = merged.find((row) => row.date === date);
  if (!day) {
    // Outside the display week (lead time can reach back a day).
    const template = templateForDate(date);
    const rules = templateRulesForDate(template.days, date);
    return {
      date,
      conductorRule: rules.conductorRule,
      vipRule: rules.vipRule,
      sourceTemplateId: template.id,
      dayConfigId: null,
    };
  }

  return {
    date: day.date,
    conductorRule: day.conductorRule,
    vipRule: day.vipRule,
    sourceTemplateId: day.sourceTemplateId,
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
