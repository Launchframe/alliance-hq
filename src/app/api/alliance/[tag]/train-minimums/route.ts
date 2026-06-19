import { NextResponse } from "next/server";
import { z } from "zod";

import {
  allianceRouteErrorResponse,
  requireAllianceRoutePermission,
  resolveAllianceRouteForSession,
} from "@/lib/alliance/alliance-route-context.server";
import {
  loadTrainConductorMinimums,
  saveTrainConductorMinimums,
} from "@/lib/trains/train-conductor-minimums.server";
import { TRAIN_MINIMUMS_WINDOWS } from "@/lib/trains/train-conductor-minimums.shared";
import { sessionHasPermissionForAlliance } from "@/lib/rbac/context";
import { getOrCreateSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  minVsPoints: z.number().int().min(0).nullable().optional(),
  minDonationPoints: z.number().int().min(0).nullable().optional(),
  leewayPct: z.number().int().min(0).max(100).optional(),
  window: z.enum(TRAIN_MINIMUMS_WINDOWS).optional(),
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
    const settings = await loadTrainConductorMinimums(
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
        { error: "Invalid train minimums payload." },
        { status: 400 },
      );
    }

    const saved = await saveTrainConductorMinimums(
      alliance.allianceId,
      body.data,
    );

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
