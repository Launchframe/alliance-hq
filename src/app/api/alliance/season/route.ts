import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getEffectiveSeasonForAlliance,
  loadAllianceSeasonRow,
  setAllianceSeasonOverride,
} from "@/lib/game-season/sync";
import { getOrCreateSession, loadSession } from "@/lib/session";
import { sessionHasPermission } from "@/lib/rbac/context";
import { requireAllianceAdmin, requireSessionPermission } from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  seasonKeyOverride: z.string().trim().min(1).max(8).nullable(),
});

export async function GET() {
  try {
    const session = await getOrCreateSession();
    const denied = await requireSessionPermission(session.id, "scores:read");
    if (denied) return denied;

    const loaded = await loadSession(session.id);
    const allianceId = loaded?.currentAllianceId ?? loaded?.allianceId;
    if (!allianceId) {
      return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
    }

    const [effective, row, canManageSeason] = await Promise.all([
      getEffectiveSeasonForAlliance(allianceId),
      loadAllianceSeasonRow(allianceId),
      sessionHasPermission(session.id, "alliance:admin"),
    ]);

    return NextResponse.json({
      seasonKey: effective.seasonKey,
      source: effective.source,
      isPostSeason: effective.isPostSeason,
      week: effective.week,
      gameServerNumber: effective.gameServerNumber,
      seasonKeyOverride: row?.seasonKeyOverride ?? null,
      canManageSeason,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load season settings.",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await getOrCreateSession();
    const denied = await requireAllianceAdmin(session.id);
    if (denied) return denied;

    const loaded = await loadSession(session.id);
    const allianceId = loaded?.currentAllianceId ?? loaded?.allianceId;
    if (!allianceId) {
      return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
    }

    const body = patchSchema.safeParse(await request.json());
    if (!body.success) {
      return NextResponse.json({ error: "Invalid season payload." }, { status: 400 });
    }

    const effective = await setAllianceSeasonOverride(
      allianceId,
      body.data.seasonKeyOverride,
    );
    const row = await loadAllianceSeasonRow(allianceId);

    return NextResponse.json({
      seasonKey: effective.seasonKey,
      source: effective.source,
      isPostSeason: effective.isPostSeason,
      week: effective.week,
      gameServerNumber: effective.gameServerNumber,
      seasonKeyOverride: row?.seasonKeyOverride ?? null,
      canManageSeason: true,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to update season.",
      },
      { status: 500 },
    );
  }
}
