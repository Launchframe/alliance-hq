import { NextResponse } from "next/server";
import { z } from "zod";

import {
  allianceRouteErrorResponse,
  requireAllianceRoutePermission,
  resolveAllianceRouteForSession,
} from "@/lib/alliance/alliance-route-context.server";
import {
  getEffectiveSeasonForAlliance,
  loadAllianceSeasonRow,
  setAllianceSeasonOverride,
} from "@/lib/game-season/sync";
import { sessionHasPermissionForAlliance } from "@/lib/rbac/context";
import { getOrCreateSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  seasonKeyOverride: z.string().trim().min(1).max(8).nullable(),
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

    const [effective, row, canManageSeason] = await Promise.all([
      getEffectiveSeasonForAlliance(alliance.allianceId),
      loadAllianceSeasonRow(alliance.allianceId),
      sessionHasPermissionForAlliance(
        session.id,
        alliance.allianceId,
        "alliance:admin",
      ),
    ]);

    return NextResponse.json({
      allianceTag: alliance.tag,
      allianceName: alliance.name,
      seasonKey: effective.seasonKey,
      source: effective.source,
      isPostSeason: effective.isPostSeason,
      week: effective.week,
      gameServerNumber: effective.gameServerNumber,
      seasonKeyOverride: row?.seasonKeyOverride ?? null,
      canManageSeason,
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
      return NextResponse.json({ error: "Invalid season payload." }, { status: 400 });
    }

    const effective = await setAllianceSeasonOverride(
      alliance.allianceId,
      body.data.seasonKeyOverride,
    );
    const row = await loadAllianceSeasonRow(alliance.allianceId);

    return NextResponse.json({
      allianceTag: alliance.tag,
      allianceName: alliance.name,
      seasonKey: effective.seasonKey,
      source: effective.source,
      isPostSeason: effective.isPostSeason,
      week: effective.week,
      gameServerNumber: effective.gameServerNumber,
      seasonKeyOverride: row?.seasonKeyOverride ?? null,
      canManageSeason: true,
    });
  } catch (error) {
    return allianceRouteErrorResponse(error);
  }
}
