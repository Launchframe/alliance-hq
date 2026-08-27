import "server-only";

import {
  resolveAnchorTemplateType,
  resolveRollDayConfig,
  type ResolvedRollDayConfig,
} from "@/lib/trains/day-config-resolve.server";
import { addCalendarDays } from "@/lib/trains/game-time";
import { loadAllianceRow } from "@/lib/members/game-roster";
import { loadAllianceTrainLeadTimeDays } from "@/lib/trains/alliance-train-lead-time.server";
import {
  getWeekSchedule,
  listDayConfigsForWeek,
} from "@/lib/trains/repository";
import {
  allianceTrainWeekFromRow,
  getTrainWeekStart,
} from "@/lib/trains/train-week-calendar.shared";
import {
  scoreDateForTrainDay,
  toDayMechanismConfig,
  type DayMechanismConfig,
} from "@/lib/trains/train-day-context.shared";
import {
  buildWeekScheduleDayConfigs,
  type MergedWeekScheduleDayConfig,
} from "@/lib/trains/week-schedule-day-configs.shared";
import type { WeekTemplateType } from "@/lib/trains/types";

export type TrainDayContext = {
  trainDate: string;
  leadDays: number;
  scoreDate: string;
  seasonKey: string;
  dayConfig: ResolvedRollDayConfig;
  trainDay: DayMechanismConfig;
  scoreDateDay: DayMechanismConfig | null;
};

export type WeekScheduleDayConfigShape = {
  id: string;
  date: string;
  conductorMechanism: string;
  vipMechanism: string | null;
  vipConfig: unknown;
  isOverride: boolean;
  paintTemplate?: WeekTemplateType | null;
  topN?: number | null;
  conductorConfig?: unknown;
};

export function mergedDayToWeekScheduleDayConfig(
  merged: MergedWeekScheduleDayConfig,
): WeekScheduleDayConfigShape {
  return {
    id: merged.id,
    date: merged.date,
    conductorMechanism: merged.conductorMechanism,
    vipMechanism: merged.vipMechanism,
    vipConfig: merged.vipConfig,
    isOverride: merged.isOverride,
    paintTemplate: merged.paintTemplate,
    topN: merged.topN,
    conductorConfig: merged.conductorConfig ?? null,
  };
}

/**
 * Merged week-template day configs for a calendar date range (month grid, nomination
 * scan). Matches rolls / week strip — not raw `train_day_configs` rows alone.
 */
export async function resolveMergedDayConfigsForDateRange(input: {
  allianceId: string;
  startDate: string;
  endDate: string;
  seasonKey: string;
}): Promise<Map<string, WeekScheduleDayConfigShape>> {
  const allianceRow = await loadAllianceRow(input.allianceId);
  const trainWeek = allianceTrainWeekFromRow(allianceRow ?? {});
  const anchorTemplate = await resolveAnchorTemplateType(
    input.allianceId,
    input.seasonKey,
  );

  const weekStarts = new Set<string>();
  for (
    let date = input.startDate;
    date <= input.endDate;
    date = addCalendarDays(date, 1)
  ) {
    weekStarts.add(getTrainWeekStart(date, trainWeek));
  }

  const byDate = new Map<string, WeekScheduleDayConfigShape>();
  for (const weekStart of weekStarts) {
    const weekEnd = addCalendarDays(weekStart, 6);
    const scheduleRow = await getWeekSchedule(
      input.allianceId,
      weekStart,
      input.seasonKey,
    );
    const templateType = (scheduleRow?.templateType ??
      anchorTemplate) as WeekTemplateType;
    const dayConfigRows = await listDayConfigsForWeek(
      input.allianceId,
      weekStart,
      weekEnd,
    );
    const merged = buildWeekScheduleDayConfigs(
      weekStart,
      templateType,
      dayConfigRows,
    );
    for (const day of merged) {
      if (day.date >= input.startDate && day.date <= input.endDate) {
        byDate.set(day.date, mergedDayToWeekScheduleDayConfig(day));
      }
    }
  }

  return byDate;
}

/** Full merged train-day context for rolls, nomination, and score stats. */
export async function resolveTrainDayContext(input: {
  allianceId: string;
  trainDate: string;
  seasonKey: string;
  leadDays?: number;
}): Promise<TrainDayContext> {
  const leadDays =
    input.leadDays ??
    (await loadAllianceTrainLeadTimeDays(input.allianceId));
  const dayConfig = await resolveRollDayConfig(
    input.allianceId,
    input.trainDate,
    input.seasonKey,
  );
  const trainDay = toDayMechanismConfig({
    conductorMechanism: dayConfig.conductorMechanism,
    conductorConfig: dayConfig.conductorConfig,
    paintTemplate: dayConfig.paintTemplate,
  });
  const scoreDate = scoreDateForTrainDay(input.trainDate, leadDays);
  let scoreDateDay: DayMechanismConfig | null = null;
  if (leadDays > 0) {
    const scoreDayConfig = await resolveRollDayConfig(
      input.allianceId,
      scoreDate,
      input.seasonKey,
    );
    scoreDateDay = toDayMechanismConfig(scoreDayConfig);
  }

  return {
    trainDate: input.trainDate,
    leadDays,
    scoreDate,
    seasonKey: input.seasonKey,
    dayConfig,
    trainDay,
    scoreDateDay,
  };
}

/** Score reference day's painted rule (merged config), with optional in-memory cache. */
export async function resolveScoreDateDayConfigForTrainDate(input: {
  allianceId: string;
  trainDate: string;
  leadDays: number;
  seasonKey: string;
  scoreDateDay?: DayMechanismConfig | null;
  mergedByDate?: ReadonlyMap<string, DayMechanismConfig>;
}): Promise<DayMechanismConfig | null> {
  if (input.scoreDateDay) return input.scoreDateDay;
  if (input.leadDays <= 0) return null;

  const scoreDate = scoreDateForTrainDay(input.trainDate, input.leadDays);
  const fromCache = input.mergedByDate?.get(scoreDate);
  if (fromCache) return toDayMechanismConfig(fromCache);

  const resolved = await resolveRollDayConfig(
    input.allianceId,
    scoreDate,
    input.seasonKey,
  );
  return toDayMechanismConfig(resolved);
}
