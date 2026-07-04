import { NextResponse } from "next/server";

import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { resolveRollDayConfig } from "@/lib/trains/day-config-resolve.server";
import { listPoolEntries, getPoolSummary } from "@/lib/trains/pool";
import { reseedPool } from "@/lib/trains/service";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import type { PoolType } from "@/lib/trains/types";
import {
  vsScoreContextForTrainDate,
  type VsScoreContext,
} from "@/lib/trains/vs-week-days.shared";
import { fetchVsScoresByRecordedDate } from "@/lib/trains/vs-scores.server";
import { getOrCreateSession } from "@/lib/session";
import {
  requireSessionPermission,
  requireTrainOfficer,
} from "@/lib/rbac/require-permission";
import { trainRollErrorResponse } from "@/lib/trains/roll-errors.server";

export const dynamic = "force-dynamic";

export type EventPoolContextPayload = VsScoreContext;

export async function GET(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "scores:read");
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const params = new URL(request.url).searchParams;
  const poolType = params.get("poolType") as PoolType | null;
  const trainDate = params.get("date")?.trim() || null;

  if (!poolType) {
    return NextResponse.json({ error: "poolType is required." }, { status: 400 });
  }

  const summary = await getPoolSummary(ctx.allianceId, poolType);
  const entries = await listPoolEntries(ctx.allianceId, poolType);

  if (poolType === "event_top_x" && trainDate) {
    const eventContext = vsScoreContextForTrainDate(trainDate);
    let scoresByMember: Map<string, number> | null = null;
    if (ctx.connection) {
      scoresByMember = await fetchVsScoresByRecordedDate(
        ctx.connection,
        ctx.ashedAllianceId,
        eventContext.scoreDate,
      );
    }

    return NextResponse.json({
      summary,
      eventContext,
      entries: entries.map((entry) => ({
        ...entry,
        vsScore: scoresByMember?.get(entry.memberId) ?? null,
      })),
    });
  }

  return NextResponse.json({ summary, entries });
}

export async function POST(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const body = (await request.json()) as {
    poolType?: PoolType;
    date?: string;
  };

  if (!body.poolType) {
    return NextResponse.json({ error: "poolType is required." }, { status: 400 });
  }

  try {
    const date = body.date?.trim() || getServerCalendarDate();
    const { seasonKey } = await getEffectiveSeasonForAlliance(ctx.allianceId);
    const dayConfig = await resolveRollDayConfig(
      ctx.allianceId,
      date,
      seasonKey,
    );
    const result = await reseedPool({
      allianceId: ctx.allianceId,
      poolType: body.poolType,
      date,
      connection: ctx.connection,
      ashedAllianceId: ctx.ashedAllianceId,
      paintTemplate: dayConfig.paintTemplate,
    });
    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = trainRollErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
