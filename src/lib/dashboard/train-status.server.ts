import "server-only";

import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { getWeekSchedule, listConductorRecordsForWeek } from "@/lib/trains/repository";
import {
  addCalendarDays,
  getServerCalendarDate,
} from "@/lib/trains/game-time";
import { getTrainWeekStart } from "@/lib/trains/train-week-calendar.shared";
import { loadAllianceRow } from "@/lib/members/game-roster";
import { resolveAnchorTemplateType } from "@/lib/trains/day-config-resolve.server";
import type { WeekTemplateType } from "@/lib/trains/types";

export type DashboardTrainStatus =
  | { state: "no_template"; weekStart: string }
  | {
      state: "awaiting_conductor";
      weekStart: string;
      today: string;
      templateType: WeekTemplateType;
    }
  | {
      state: "in_progress";
      weekStart: string;
      today: string;
      templateType: WeekTemplateType;
      conductorMemberName: string | null;
      vipMemberName: string | null;
      lockedAt: string | null;
    };

export async function loadDashboardTrainStatus(
  allianceId: string,
): Promise<DashboardTrainStatus> {
  const today = getServerCalendarDate();
  const allianceRow = await loadAllianceRow(allianceId);
  const weekStart = getTrainWeekStart(today, allianceRow);
  const weekEnd = addCalendarDays(weekStart, 6);
  const effectiveSeason = await getEffectiveSeasonForAlliance(allianceId);

  const scheduleRow = await getWeekSchedule(
    allianceId,
    weekStart,
    effectiveSeason.seasonKey,
  );

  const templateType: WeekTemplateType = scheduleRow
    ? (scheduleRow.templateType as WeekTemplateType)
    : await resolveAnchorTemplateType(allianceId, effectiveSeason.seasonKey);

  if (!scheduleRow) {
    return { state: "no_template", weekStart };
  }

  const weekRecords = await listConductorRecordsForWeek(
    allianceId,
    weekStart,
    weekEnd,
    effectiveSeason.seasonKey,
  );
  const todayRecord = weekRecords.find((row) => row.date === today) ?? null;

  if (!todayRecord?.lockedAt) {
    return {
      state: "awaiting_conductor",
      weekStart,
      today,
      templateType,
    };
  }

  return {
    state: "in_progress",
    weekStart,
    today,
    templateType,
    conductorMemberName: todayRecord.conductorMemberName,
    vipMemberName: todayRecord.vipMemberName,
    lockedAt: todayRecord.lockedAt?.toISOString() ?? null,
  };
}
