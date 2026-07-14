import { NextResponse } from "next/server";
import { z } from "zod";

import { writeAuditLog } from "@/lib/bff/audit";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";
import { getOrCreateSession } from "@/lib/session";
import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import {
  loadTrainEconomyThreshold,
  saveTrainEconomyThreshold,
} from "@/lib/trains/train-economy-threshold.server";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  weightingEnabled: z.boolean(),
});

/** Patch only Price Is Freight draw mode (Equal chance vs Closer is Better). */
export async function PATCH(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const body = patchSchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json(
      { error: "weightingEnabled (boolean) is required." },
      { status: 400 },
    );
  }

  const before = await loadTrainEconomyThreshold(ctx.allianceId, true);
  let saved: Awaited<ReturnType<typeof saveTrainEconomyThreshold>>;
  try {
    saved = await saveTrainEconomyThreshold(ctx.allianceId, {
      weightingEnabled: body.data.weightingEnabled,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not save draw mode.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (before.weightingEnabled !== saved.weightingEnabled) {
    await writeAuditLog({
      sessionId: session.id,
      allianceId: ctx.allianceId,
      hqUserId: session.hqUserId ?? undefined,
      action: "trains.price_is_right.weighting_updated",
      resourceType: "alliance",
      resourceId: ctx.allianceId,
      metadata: {
        before: { weightingEnabled: before.weightingEnabled },
        after: { weightingEnabled: saved.weightingEnabled },
      },
    });
  }

  return NextResponse.json({
    weightingEnabled: saved.weightingEnabled,
  });
}
