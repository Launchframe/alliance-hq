import { NextResponse } from "next/server";

import { getAshedAllianceIdIfLinked } from "@/lib/alliance/ashed-write-guard";
import { buildDataDateSummaries } from "@/lib/data-management/batch-actions.server";
import { listAllianceDataBatches } from "@/lib/data-management/batch-ledger.server";
import { resolveDataManagementApiContext } from "@/lib/data-management/api-context.server";
import { getScoreTarget, SCORE_TARGETS } from "@/lib/video/score-targets";
import { getAshedConnection } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ctx = await resolveDataManagementApiContext();
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(request.url);
  const scoreTarget = url.searchParams.get("scoreTarget")?.trim() || undefined;
  const target = scoreTarget ? getScoreTarget(scoreTarget) : undefined;
  if (scoreTarget && !target) {
    return NextResponse.json({ error: "Unknown score target." }, { status: 400 });
  }

  const resolvedTarget = target?.id ?? SCORE_TARGETS.find((t) => t.enabled)?.id;
  const resolvedDef = resolvedTarget ? getScoreTarget(resolvedTarget) : undefined;
  if (!resolvedDef) {
    return NextResponse.json({ dates: [], scoreTargets: [] });
  }

  const [connection, ashedAllianceId, ledgerBatches] = await Promise.all([
    getAshedConnection(ctx.sessionId),
    getAshedAllianceIdIfLinked(ctx.allianceId),
    listAllianceDataBatches({
      allianceId: ctx.allianceId,
      scoreTarget: resolvedDef.id,
      status: "active",
    }),
  ]);

  const dates = await buildDataDateSummaries({
    connection,
    ashedAllianceId,
    submitEntity: resolvedDef.submitEntity,
    ledgerBatches,
    rbac: ctx.rbac,
  });

  return NextResponse.json({
    dates,
    scoreTarget: resolvedDef.id,
    scoreTargets: SCORE_TARGETS.filter((t) => t.enabled).map((t) => ({
      id: t.id,
      labelKey: t.labelKey,
      submitEntity: t.submitEntity,
    })),
  });
}
