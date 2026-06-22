import { NextResponse } from "next/server";
import { z } from "zod";

import {
  allianceRouteErrorResponse,
  requireAllianceRoutePermission,
  resolveAllianceRouteForSession,
} from "@/lib/alliance/alliance-route-context.server";
import { writeAuditLog } from "@/lib/bff/audit";
import {
  loadAllianceTrainWeekSettings,
  saveAllianceTrainWeekStartDow,
} from "@/lib/trains/alliance-train-week.server";
import { sessionHasPermissionForAlliance } from "@/lib/rbac/context";
import { getOrCreateSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  trainWeekStartDow: z.number().int().min(0).max(6),
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
    const settings = await loadAllianceTrainWeekSettings(
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
        { error: "Invalid train week settings payload." },
        { status: 400 },
      );
    }

    const before = await loadAllianceTrainWeekSettings(alliance.allianceId, true);
    const saved = await saveAllianceTrainWeekStartDow(
      alliance.allianceId,
      body.data.trainWeekStartDow,
    );

    if (before.trainWeekStartDow !== saved.trainWeekStartDow) {
      await writeAuditLog({
        sessionId: session.id,
        allianceId: alliance.allianceId,
        hqUserId: session.hqUserId ?? undefined,
        action: "trains.alliance_train_week_update",
        resourceType: "alliance",
        resourceId: alliance.allianceId,
        resourceName: alliance.name,
        metadata: {
          before: { trainWeekStartDow: before.trainWeekStartDow },
          after: { trainWeekStartDow: saved.trainWeekStartDow },
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
