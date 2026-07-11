import { NextResponse } from "next/server";

import {
  decorateBatchForViewer,
  listAllianceDataBatches,
} from "@/lib/data-management/batch-ledger.server";
import { resolveDataManagementApiContext } from "@/lib/data-management/api-context.server";
import { SCORE_TARGETS } from "@/lib/video/score-targets";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ctx = await resolveDataManagementApiContext();
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(request.url);
  const scoreTarget = url.searchParams.get("scoreTarget")?.trim() || undefined;

  const batches = await listAllianceDataBatches({
    allianceId: ctx.allianceId,
    scoreTarget,
    status: "active",
  });

  return NextResponse.json({
    batches: batches.map((batch) => decorateBatchForViewer(batch, ctx.rbac)),
    scoreTargets: SCORE_TARGETS.filter((target) => target.enabled).map(
      (target) => ({
        id: target.id,
        labelKey: target.labelKey,
        submitEntity: target.submitEntity,
      }),
    ),
  });
}
