import { NextResponse } from "next/server";

import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { listPoolEntries, getPoolSummary } from "@/lib/trains/pool";
import { reseedPool } from "@/lib/trains/service";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import type { PoolType } from "@/lib/trains/types";
import { getOrCreateSession } from "@/lib/session";
import {
  requireSessionPermission,
  requireTrainOfficer,
} from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "scores:read");
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const poolType = new URL(request.url).searchParams.get(
    "poolType",
  ) as PoolType | null;
  if (!poolType) {
    return NextResponse.json({ error: "poolType is required." }, { status: 400 });
  }

  const summary = await getPoolSummary(ctx.allianceId, poolType);
  const entries = await listPoolEntries(ctx.allianceId, poolType);
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
    const result = await reseedPool({
      allianceId: ctx.allianceId,
      poolType: body.poolType,
      date: body.date?.trim() || getServerCalendarDate(),
      connection: ctx.connection,
      ashedAllianceId: ctx.ashedAllianceId,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Pool seed failed." },
      { status: 400 },
    );
  }
}
