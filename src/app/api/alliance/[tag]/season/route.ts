import { NextResponse } from "next/server";
import { z } from "zod";

import {
  allianceRouteErrorResponse,
  requireAllianceRoutePermission,
  resolveAllianceRouteForSession,
} from "@/lib/alliance/alliance-route-context.server";
import { writeAuditLog } from "@/lib/bff/audit";
import {
  applySeasonSync,
  getEffectiveSeasonForAlliance,
  loadAllianceSeasonRow,
  setAllianceSeasonOverride,
  updateAllianceGameServerNumber,
} from "@/lib/game-season/sync";
import { resolveAllianceGameServerNumber } from "@/lib/game-season/game-servers.server";
import { isNativeAlliance } from "@/lib/native-alliance/operating-mode";
import { sessionHasPermissionForAlliance } from "@/lib/rbac/context";
import { getOrCreateSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  seasonKeyOverride: z.string().trim().min(1).max(8).nullable().optional(),
  gameServerNumber: z.number().int().positive().max(9999).optional(),
  /** Re-fetch season from cpt-hedge (ignored when a manual override is set). */
  resyncSeason: z.boolean().optional(),
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

    const [effective, row, canManageSeason, native, linkedGameServerNumber] =
      await Promise.all([
      getEffectiveSeasonForAlliance(alliance.allianceId),
      loadAllianceSeasonRow(alliance.allianceId),
      sessionHasPermissionForAlliance(
        session.id,
        alliance.allianceId,
        "alliance:admin",
      ),
      isNativeAlliance(alliance.allianceId),
      resolveAllianceGameServerNumber(alliance.allianceId),
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
      canEditGameServer: native && canManageSeason,
      hasLinkedGameServer: linkedGameServerNumber != null,
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

    const beforeRow = await loadAllianceSeasonRow(alliance.allianceId);
    const beforeLinkedServer = await resolveAllianceGameServerNumber(
      alliance.allianceId,
    );
    const beforeEffective = await getEffectiveSeasonForAlliance(
      alliance.allianceId,
    );

    if (body.data.gameServerNumber !== undefined) {
      const native = await isNativeAlliance(alliance.allianceId);
      if (!native) {
        return NextResponse.json(
          { error: "Game server number is managed by Ashed for connected alliances." },
          { status: 400 },
        );
      }
      await updateAllianceGameServerNumber(
        alliance.allianceId,
        body.data.gameServerNumber,
      );
    }

    let effective =
      body.data.seasonKeyOverride !== undefined
        ? await setAllianceSeasonOverride(
            alliance.allianceId,
            body.data.seasonKeyOverride,
          )
        : null;

    if (effective == null && body.data.resyncSeason) {
      const row = await loadAllianceSeasonRow(alliance.allianceId);
      if (row?.seasonKeyOverride?.trim()) {
        return NextResponse.json(
          {
            error:
              "Clear the manual season override before refreshing from cpt-hedge.",
          },
          { status: 400 },
        );
      }
      if (row?.gameServerNumber == null) {
        return NextResponse.json(
          {
            error:
              "Link a state server before refreshing from cpt-hedge.",
          },
          { status: 400 },
        );
      }
      effective = await applySeasonSync(alliance.allianceId, {
        forceRefresh: true,
      });
    }

    if (effective == null && body.data.gameServerNumber !== undefined) {
      effective = await applySeasonSync(alliance.allianceId, {
        forceRefresh: true,
      });
    }

    if (effective == null) {
      effective = await getEffectiveSeasonForAlliance(alliance.allianceId);
    }
    const row = await loadAllianceSeasonRow(alliance.allianceId);
    const native = await isNativeAlliance(alliance.allianceId);
    const linkedGameServerNumber = await resolveAllianceGameServerNumber(
      alliance.allianceId,
    );

    const beforeOverride = beforeRow?.seasonKeyOverride ?? null;
    const afterOverride = row?.seasonKeyOverride ?? null;
    if (
      body.data.seasonKeyOverride !== undefined &&
      beforeOverride !== afterOverride
    ) {
      await writeAuditLog({
        sessionId: session.id,
        allianceId: alliance.allianceId,
        hqUserId: session.hqUserId ?? undefined,
        action: "alliance.season_override_update",
        resourceType: "alliance",
        resourceId: alliance.allianceId,
        resourceName: alliance.name,
        metadata: {
          before: { seasonKeyOverride: beforeOverride },
          after: { seasonKeyOverride: afterOverride },
          effectiveSeasonKey: effective.seasonKey,
        },
      });
    }

    if (
      body.data.gameServerNumber !== undefined &&
      beforeLinkedServer !== linkedGameServerNumber
    ) {
      await writeAuditLog({
        sessionId: session.id,
        allianceId: alliance.allianceId,
        hqUserId: session.hqUserId ?? undefined,
        action: "alliance.game_server_update",
        resourceType: "alliance",
        resourceId: alliance.allianceId,
        resourceName: alliance.name,
        metadata: {
          before: { gameServerNumber: beforeLinkedServer },
          after: { gameServerNumber: linkedGameServerNumber },
        },
      });
    }

    if (body.data.resyncSeason) {
      await writeAuditLog({
        sessionId: session.id,
        allianceId: alliance.allianceId,
        hqUserId: session.hqUserId ?? undefined,
        action: "alliance.season_resync",
        resourceType: "alliance",
        resourceId: alliance.allianceId,
        resourceName: alliance.name,
        metadata: {
          before: {
            seasonKey: beforeEffective.seasonKey,
            source: beforeEffective.source,
          },
          after: {
            seasonKey: effective.seasonKey,
            source: effective.source,
          },
        },
      });
    }

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
      canEditGameServer: native,
      hasLinkedGameServer: linkedGameServerNumber != null,
    });
  } catch (error) {
    return allianceRouteErrorResponse(error);
  }
}
