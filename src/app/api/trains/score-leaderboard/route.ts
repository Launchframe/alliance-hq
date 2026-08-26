import { NextResponse } from "next/server";

import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import {
  resolveScoreLeaderboardKind,
} from "@/lib/trains/score-leaderboard-podium.shared";
import { loadScoreLeaderboard } from "@/lib/trains/score-leaderboard.server";
import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { resolveRollDayConfig } from "@/lib/trains/day-config-resolve.server";
import { loadAllianceTrainLeadTimeDays } from "@/lib/trains/alliance-train-lead-time.server";
import { loadAllianceTrainWeekConfig } from "@/lib/trains/service";
import { getTrainWeekStart } from "@/lib/trains/train-week-calendar.shared";
import { getWeekSchedule } from "@/lib/trains/repository";
import { vsScoreReferenceDate } from "@/lib/trains/vs-week-days.shared";
import { requireApiSession } from "@/lib/session";
import { requireSessionPermission } from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const sessionOrError = await requireApiSession();

  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  const denied = await requireSessionPermission(session.id, "scores:read");
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const params = new URL(request.url).searchParams;
  const trainDate = params.get("date")?.trim();
  // Optional `kind` query is ignored; the server resolves kind from day rules.

  if (!trainDate || !/^\d{4}-\d{2}-\d{2}$/.test(trainDate)) {
    return NextResponse.json(
      { error: "date query parameter (YYYY-MM-DD) is required." },
      { status: 400 },
    );
  }

  const { seasonKey } = await getEffectiveSeasonForAlliance(ctx.allianceId);
  const leadDays = await loadAllianceTrainLeadTimeDays(ctx.allianceId);
  const trainWeekConfig = await loadAllianceTrainWeekConfig(ctx.allianceId);
  const weekStart = getTrainWeekStart(trainDate, trainWeekConfig);
  const weekSchedule = await getWeekSchedule(
    ctx.allianceId,
    weekStart,
    seasonKey,
  );
  const weekTemplateType = weekSchedule?.templateType ?? null;

  const dayConfig = await resolveRollDayConfig(
    ctx.allianceId,
    trainDate,
    seasonKey,
  );
  const scoreDate = vsScoreReferenceDate(trainDate, leadDays);
  const scoreDateDayConfig = await resolveRollDayConfig(
    ctx.allianceId,
    scoreDate,
    seasonKey,
  );

  const dayKind = resolveScoreLeaderboardKind({
    paintTemplate: dayConfig.paintTemplate,
    conductorMechanism: dayConfig.conductorMechanism,
    trainDate,
    leadDays,
    weekTemplateType,
    weekStart,
    scoreDateDay: {
      conductorMechanism: scoreDateDayConfig.conductorMechanism,
      conductorConfig: scoreDateDayConfig.conductorConfig,
      paintTemplate: scoreDateDayConfig.paintTemplate,
    },
  });

  if (!dayKind) {
    return NextResponse.json(
      { error: "This day does not use a score leaderboard." },
      { status: 400 },
    );
  }

  const resolvedKind = dayKind;

  try {
    const payload = await loadScoreLeaderboard({
      allianceId: ctx.allianceId,
      trainDate,
      kind: resolvedKind,
      hqUserId: session.hqUserId,
    });
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Load failed.";
    const status = message.includes("Price Is Freight") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
