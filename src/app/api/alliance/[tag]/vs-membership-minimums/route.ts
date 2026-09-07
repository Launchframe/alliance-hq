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
  loadVsMembershipSettings,
  saveVsMembershipSettings,
} from "@/lib/vs-compliance/vs-membership-settings.server";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  minPoints: z.number().int().min(0).nullable().optional(),
  missStrikesBeforeKick: z.number().int().min(1).max(20).optional(),
  leewayPct: z.number().int().min(0).max(100).optional(),
});

type RouteContext = { params: Promise<{ tag: string }> };

/** Read: officer-visible (mirrors train minimums GET — scores:read). */
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
    const settings = await loadVsMembershipSettings(
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

/**
 * Write: owner/maintainer only (`alliance:admin`) — not `trains:write`.
 * Officers can view minimums but cannot change kick/demotion thresholds.
 */
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
        { error: "Invalid VS membership minimums payload." },
        { status: 400 },
      );
    }

    const before = await loadVsMembershipSettings(alliance.allianceId, true);
    const saved = await saveVsMembershipSettings(alliance.allianceId, body.data);

    const changed =
      before.minPoints !== saved.minPoints ||
      before.missStrikesBeforeKick !== saved.missStrikesBeforeKick ||
      before.leewayPct !== saved.leewayPct;

    if (!changed) {
      return NextResponse.json({
        allianceTag: alliance.tag,
        allianceName: alliance.name,
        ...saved,
        canManage: true,
        unchanged: true,
      });
    }

    await writeAuditLog({
      sessionId: session.id,
      allianceId: alliance.allianceId,
      hqUserId: session.hqUserId ?? undefined,
      action: "vs_compliance.membership_minimums_update",
      resourceType: "alliance",
      resourceId: alliance.allianceId,
      resourceName: alliance.name,
      metadata: {
        before,
        after: saved,
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
