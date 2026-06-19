import "server-only";

import { paintTemplateFromConductorConfig } from "@/lib/trains/calendar-cell-styles.shared";
import { effectiveConductorMechanism } from "@/lib/trains/conductor-mechanism.shared";
import { getServerCalendarDate, getWeekStartMonday } from "@/lib/trains/game-time";
import { getDayConfig, getWeekSchedule } from "@/lib/trains/repository";
import { generateDayConfigForDate } from "@/lib/trains/templates";
import type {
  ConductorMechanismType,
  DayConfigInput,
  VipMechanismType,
  WeekTemplateType,
} from "@/lib/trains/types";

export type ResolvedRollDayConfig = DayConfigInput & {
  dayConfigId: string | null;
};

export async function resolveAnchorTemplateType(
  allianceId: string,
  seasonKey: string,
): Promise<WeekTemplateType> {
  const today = getServerCalendarDate();
  const anchorSchedule = await getWeekSchedule(
    allianceId,
    getWeekStartMonday(today),
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
      ) ?? (stored.conductorMechanism as ConductorMechanismType);
    return {
      date: stored.date,
      conductorMechanism,
      vipMechanism: (stored.vipMechanism ?? "none") as VipMechanismType,
      vipConfig: stored.vipConfig as DayConfigInput["vipConfig"],
      dayConfigId: stored.id,
    };
  }

  const weekStart = getWeekStartMonday(date);
  const weekSchedule = await getWeekSchedule(allianceId, weekStart, seasonKey);
  const anchorTemplate = await resolveAnchorTemplateType(allianceId, seasonKey);
  const templateType = (weekSchedule?.templateType ??
    anchorTemplate) as WeekTemplateType;
  const generated = generateDayConfigForDate(templateType, date, weekStart);

  return {
    ...generated,
    dayConfigId: null,
  };
}
