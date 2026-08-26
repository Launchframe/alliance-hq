import { NextResponse } from "next/server";

import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { memberIdsEligibleForPoolType } from "@/lib/trains/rank-history";
import { resolveRollDayConfig } from "@/lib/trains/day-config-resolve.server";
import {
  listPoolEntries,
  getPoolSummary,
  listPriorPoolGenerationSnapshots,
} from "@/lib/trains/pool";
import {
  assessRestorePreviousPoolGeneration,
  PoolGenerationMergeError,
  restorePreviousPoolGeneration,
} from "@/lib/trains/pool-generation-merge.server";
import { reseedPool } from "@/lib/trains/service";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import type { PoolType } from "@/lib/trains/types";
import { loadAllianceTrainLeadTimeDays } from "@/lib/trains/alliance-train-lead-time.server";
import {
  vsScoreContextForTrainDate,
  type VsScoreContext,
} from "@/lib/trains/vs-week-days.shared";
import { fetchHqSeasonVsScoresByMember } from "@/lib/trains/native-scores.server";
import { sessionHasPermission } from "@/lib/rbac/context";
import { requireApiSession } from "@/lib/session";
import {
  requireSessionPermission,
  requireTrainOfficer,
} from "@/lib/rbac/require-permission";
import { trainRollErrorResponse } from "@/lib/trains/roll-errors.server";

export const dynamic = "force-dynamic";

export type EventPoolContextPayload = VsScoreContext;

export async function GET(request: Request) {
  const sessionOrError = await requireApiSession();

  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
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
  const canManageTrains = await sessionHasPermission(session.id, "trains:write");
  const [rawEntries, priorGenerations, restorePreviousGeneration] =
    await Promise.all([
      listPoolEntries(ctx.allianceId, poolType),
      listPriorPoolGenerationSnapshots(ctx.allianceId, poolType),
      canManageTrains
        ? assessRestorePreviousPoolGeneration({
            allianceId: ctx.allianceId,
            poolType,
          })
        : Promise.resolve(null),
    ]);

  let entries = rawEntries;
  if (
    (poolType === "r3" || poolType === "r4_plus") &&
    trainDate &&
    rawEntries.length > 0
  ) {
    const eligibleIds = await memberIdsEligibleForPoolType(
      ctx.allianceId,
      poolType,
      trainDate,
      rawEntries.map((entry) => entry.memberId),
    );
    entries = rawEntries.filter(
      (entry) =>
        entry.selectedAt != null || eligibleIds.has(entry.memberId),
    );
  }

  if (poolType === "event_top_x" && trainDate) {
    const leadDays = await loadAllianceTrainLeadTimeDays(ctx.allianceId);
    const eventContext = vsScoreContextForTrainDate(trainDate, leadDays);
    const scoresByMember = await fetchHqSeasonVsScoresByMember(ctx.allianceId);

    return NextResponse.json({
      summary,
      priorGenerations,
      restorePreviousGeneration,
      eventContext,
      entries: entries.map((entry) => ({
        ...entry,
        vsScore: scoresByMember.get(entry.memberId) ?? null,
      })),
    });
  }

  return NextResponse.json({
    summary,
    priorGenerations,
    restorePreviousGeneration,
    entries,
  });
}

export async function POST(request: Request) {
  const sessionOrError = await requireApiSession();

  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const body = (await request.json()) as {
    poolType?: PoolType;
    date?: string;
    action?: "reseed" | "restorePreviousGeneration";
  };

  if (!body.poolType) {
    return NextResponse.json({ error: "poolType is required." }, { status: 400 });
  }

  try {
    if (body.action === "restorePreviousGeneration") {
      const result = await restorePreviousPoolGeneration({
        allianceId: ctx.allianceId,
        poolType: body.poolType,
      });
      return NextResponse.json(result);
    }

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
      paintTemplate: dayConfig.paintTemplate,
      conductorMechanism: dayConfig.conductorMechanism,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PoolGenerationMergeError) {
      const status =
        error.code === "LOCKED_DRAFT" || error.code === "SELECTED_OVERLAP"
          ? (409 as const)
          : (400 as const);
      return NextResponse.json(
        { error: error.message, mergeError: { code: error.code } },
        { status },
      );
    }
    const { status, body } = trainRollErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
