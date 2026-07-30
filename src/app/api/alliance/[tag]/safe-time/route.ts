import { NextResponse } from "next/server";
import { z } from "zod";

import {
  allianceRouteErrorResponse,
  requireAllianceRoutePermission,
  resolveAllianceRouteForSession,
} from "@/lib/alliance/alliance-route-context.server";
import {
  loadAllianceSafeTimeSettings,
  saveAllianceSafeTimeSlot,
} from "@/lib/alliance/alliance-safe-time.server";
import { ALLIANCE_SAFE_TIME_SLOTS } from "@/lib/alliance/alliance-safe-time.shared";
import { writeAuditLog } from "@/lib/bff/audit";
import { sessionHasPermissionForAlliance } from "@/lib/rbac/context";
import { getOrCreateSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  allianceSafeTimeSlot: z.enum(ALLIANCE_SAFE_TIME_SLOTS),
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
      "alliance:admin",
    );
    const settings = await loadAllianceSafeTimeSettings(
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
      "alliance:admin",
    );
    if (denied) return denied;

    const body = patchSchema.safeParse(await request.json());
    if (!body.success) {
      return NextResponse.json(
        { error: "Invalid alliance safe time payload." },
        { status: 400 },
      );
    }

    const before = await loadAllianceSafeTimeSettings(alliance.allianceId, true);
    const saved = await saveAllianceSafeTimeSlot(
      alliance.allianceId,
      body.data.allianceSafeTimeSlot,
    );

    if (before.allianceSafeTimeSlot !== saved.allianceSafeTimeSlot) {
      await writeAuditLog({
        sessionId: session.id,
        allianceId: alliance.allianceId,
        hqUserId: session.hqUserId ?? undefined,
        action: "alliance.safe_time_update",
        resourceType: "alliance",
        resourceId: alliance.allianceId,
        resourceName: alliance.name,
        metadata: {
          before: { allianceSafeTimeSlot: before.allianceSafeTimeSlot },
          after: { allianceSafeTimeSlot: saved.allianceSafeTimeSlot },
        },
      });
    }

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
