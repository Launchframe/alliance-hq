import { NextResponse } from "next/server";
import { z } from "zod";

import {
  allianceRouteErrorResponse,
  requireAllianceRoutePermission,
  resolveAllianceRouteForSession,
} from "@/lib/alliance/alliance-route-context.server";
import { writeAuditLog } from "@/lib/bff/audit";
import { sessionHasPermissionForAlliance } from "@/lib/rbac/context";
import { getOrCreateSession } from "@/lib/session";
import {
  loadTrainEconomyThreshold,
  saveTrainEconomyThreshold,
} from "@/lib/trains/train-economy-threshold.server";
import { syncHeavyHitterPool } from "@/lib/trains/heavy-hitter-pool.server";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  thresholdPoints: z.number().int().min(0).nullable().optional(),
  fudgePct: z.number().int().min(0).max(100).optional(),
  weightingEnabled: z.boolean().optional(),
  hardCutoffEnabled: z.boolean().optional(),
  maxTicketMemberIds: z.array(z.string().min(1)).max(10).optional(),
});

type RouteContext = { params: Promise<{ tag: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await getOrCreateSession();
    const { tag } = await context.params;
    const alliance = await resolveAllianceRouteForSession(session.id, tag);

    const denied = await requireAllianceRoutePermission(
      session.id,
      alliance.allianceId,
      "scores:read",
    );
    if (denied) return denied;

    const canManage = await sessionHasPermissionForAlliance(
      session.id,
      alliance.allianceId,
      "trains:write",
    );
    const settings = await loadTrainEconomyThreshold(
      alliance.allianceId,
      canManage,
    );

    return NextResponse.json({
      allianceTag: alliance.tag,
      allianceName: alliance.name,
      ...settings,
    });
  } catch (error) {
    return allianceRouteErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const session = await getOrCreateSession();
    const { tag } = await context.params;
    const alliance = await resolveAllianceRouteForSession(session.id, tag);

    const denied = await requireAllianceRoutePermission(
      session.id,
      alliance.allianceId,
      "trains:write",
    );
    if (denied) return denied;

    const body = patchSchema.safeParse(await request.json());
    if (!body.success) {
      return NextResponse.json(
        { error: "Invalid economy threshold payload." },
        { status: 400 },
      );
    }

    const before = await loadTrainEconomyThreshold(alliance.allianceId, true);
    let saved: Awaited<ReturnType<typeof saveTrainEconomyThreshold>>;
    try {
      saved = await saveTrainEconomyThreshold(alliance.allianceId, body.data);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not save settings.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const maxTicketMembersChanged =
      JSON.stringify(before.maxTicketMemberIds) !==
      JSON.stringify(saved.maxTicketMemberIds);

    const changed =
      before.thresholdPoints !== saved.thresholdPoints ||
      before.fudgePct !== saved.fudgePct ||
      before.weightingEnabled !== saved.weightingEnabled ||
      before.hardCutoffEnabled !== saved.hardCutoffEnabled ||
      maxTicketMembersChanged;

    if (!changed) {
      return NextResponse.json({
        allianceTag: alliance.tag,
        allianceName: alliance.name,
        ...saved,
        canManage: true,
        unchanged: true,
      });
    }

    if (maxTicketMembersChanged) {
      await syncHeavyHitterPool(alliance.allianceId);
    }

    await writeAuditLog({
      sessionId: session.id,
      allianceId: alliance.allianceId,
      hqUserId: session.hqUserId ?? undefined,
      action: "trains.economy_threshold_update",
      resourceType: "alliance",
      resourceId: alliance.allianceId,
      resourceName: alliance.name,
      metadata: {
        before: {
          thresholdPoints: before.thresholdPoints,
          fudgePct: before.fudgePct,
          weightingEnabled: before.weightingEnabled,
          hardCutoffEnabled: before.hardCutoffEnabled,
          maxTicketMemberIds: before.maxTicketMemberIds,
        },
        after: {
          thresholdPoints: saved.thresholdPoints,
          fudgePct: saved.fudgePct,
          weightingEnabled: saved.weightingEnabled,
          hardCutoffEnabled: saved.hardCutoffEnabled,
          maxTicketMemberIds: saved.maxTicketMemberIds,
        },
      },
    });

    return NextResponse.json({
      allianceTag: alliance.tag,
      allianceName: alliance.name,
      ...saved,
      canManage: true,
    });
  } catch (error) {
    return allianceRouteErrorResponse(error);
  }
}
