import "server-only";

import { loadAllianceRow } from "@/lib/members/game-roster";
import { paintTemplateFromConductorConfig } from "@/lib/trains/calendar-cell-styles.shared";
import { effectiveConductorMechanism } from "@/lib/trains/conductor-mechanism.shared";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import { getDayConfig, getWeekSchedule } from "@/lib/trains/repository";
import { generateDayConfigForDate } from "@/lib/trains/templates";
import {
  allianceTrainWeekFromRow,
  getTrainWeekStart,
} from "@/lib/trains/train-week-calendar.shared";
import { resolvePaintTemplateForDay } from "@/lib/trains/week-template-registry.shared";
import type {
  ConductorMechanismType,
  DayConfigInput,
  VipMechanismType,
  WeekTemplateType,
} from "@/lib/trains/types";

export type ResolvedRollDayConfig = DayConfigInput & {
  dayConfigId: string | null;
  paintTemplate?: WeekTemplateType | null;
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

/** Match month/week schedule previews when a day has no persisted config row yet. */
export async function resolveRollDayConfig(
  allianceId: string,
  date: string,
  seasonKey: string,
): Promise<ResolvedRollDayConfig> {
  const stored = await getDayConfig(allianceId, date);
  if (stored) {
    const paintTemplate = paintTemplateFromConductorConfig(stored.conductorConfig);
    const conductorMechanism =
      effectiveConductorMechanism(
        stored.conductorMechanism,
        paintTemplate,
        date,
      ) ?? (stored.conductorMechanism as ConductorMechanismType);
    return {
      date: stored.date,
      conductorMechanism,
      conductorConfig: stored.conductorConfig as DayConfigInput["conductorConfig"],
      vipMechanism: (stored.vipMechanism ?? "none") as VipMechanismType,
      vipConfig: stored.vipConfig as DayConfigInput["vipConfig"],
      dayConfigId: stored.id,
      paintTemplate,
    };
  }

  const weekStart = await trainWeekStartForAlliance(allianceId, date);
  const weekSchedule = await getWeekSchedule(allianceId, weekStart, seasonKey);
  const anchorTemplate = await resolveAnchorTemplateType(allianceId, seasonKey);
  const templateType = (weekSchedule?.templateType ??
    anchorTemplate) as WeekTemplateType;
  const generated = generateDayConfigForDate(templateType, date, weekStart);
  const paintTemplate = resolvePaintTemplateForDay(templateType, date, weekStart);

  return {
    ...generated,
    conductorConfig: { paintTemplate },
    dayConfigId: null,
    paintTemplate,
  };
}
