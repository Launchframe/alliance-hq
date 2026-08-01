import { NextResponse } from "next/server";

import {
  RosterSyncUnavailableError,
  syncAllianceRosterForSession,
} from "@/lib/members/roster-sync.server";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";
import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { loadTrainsRosterDataStatus } from "@/lib/trains/roster-data-status.server";
import { requireApiSession } from "@/lib/session";
import { getServerCalendarDate } from "@/lib/trains/service";
import { getWeekSchedule, listDayConfigsForWeek } from "@/lib/trains/repository";
import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import {
  allianceTrainWeekFromRow,
  getTrainWeekStart,
} from "@/lib/trains/train-week-calendar.shared";
import { loadAllianceRow } from "@/lib/members/game-roster";
import { resolveAnchorTemplateType } from "@/lib/trains/day-config-resolve.server";
import { resolveWeekDisplayDayConfigs } from "@/lib/trains/week-schedule-day-configs.shared";
import { addCalendarDays } from "@/lib/trains/game-time";
import type { WeekTemplateType } from "@/lib/trains/types";

export const dynamic = "force-dynamic";

async function todayConductorContext(allianceId: string, today: string) {
  const allianceRow = await loadAllianceRow(allianceId);
  const trainWeekConfig = allianceTrainWeekFromRow(allianceRow ?? {});
  const weekStart = getTrainWeekStart(today, trainWeekConfig);
  const weekEnd = addCalendarDays(weekStart, 6);
  const effectiveSeason = await getEffectiveSeasonForAlliance(allianceId);
  const scheduleRow = await getWeekSchedule(
    allianceId,
    weekStart,
    effectiveSeason.seasonKey,
  );
  const dashboardTemplateType: WeekTemplateType = scheduleRow
    ? (scheduleRow.templateType as WeekTemplateType)
    : await resolveAnchorTemplateType(allianceId, effectiveSeason.seasonKey);
  const dayConfigRows = await listDayConfigsForWeek(
    allianceId,
    weekStart,
    weekEnd,
  );
  const dayConfigs = resolveWeekDisplayDayConfigs(
    weekStart,
    dashboardTemplateType,
    dayConfigRows,
  );
  return dayConfigs.find((day) => day.date === today) ?? null;
}

export async function POST() {
  const sessionOrError = await requireApiSession();

  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  try {
    const syncResult = await syncAllianceRosterForSession({
      sessionId: session.id,
      allianceId: ctx.allianceId,
    });
    const today = getServerCalendarDate();
    const todayDayConfig = await todayConductorContext(ctx.allianceId, today);
    const rosterDataStatus = await loadTrainsRosterDataStatus({
      sessionId: session.id,
      allianceId: ctx.allianceId,
      trainDate: today,
      conductorMechanism: todayDayConfig?.conductorMechanism ?? null,
      paintTemplate: todayDayConfig?.paintTemplate ?? null,
      activeMemberCount: syncResult.activeMemberCount,
    });

    return NextResponse.json({
      ...syncResult,
      rosterDataStatus,
    });
  } catch (error) {
    if (error instanceof RosterSyncUnavailableError) {
      return NextResponse.json(
        { error: error.message, code: "ROSTER_SYNC_UNAVAILABLE" },
        { status: 409 },
      );
    }
    const message =
      error instanceof Error ? error.message : "Failed to sync roster.";
    const status = message.includes("Not connected")
      ? 401
      : message.includes("Alliance tag")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
