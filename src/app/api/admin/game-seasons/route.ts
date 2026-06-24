import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";

import {
  gameSeasonCapsChanged,
  parsePatchGameSeasonCapsBody,
} from "@/lib/admin/admin-game-seasons.shared";
import { writeAuditLog } from "@/lib/bff/audit";
import { getDb, schema } from "@/lib/db";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

export async function GET() {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const db = getDb();
  const rows = await db
    .select({
      id: schema.gameSeasons.id,
      seasonNumber: schema.gameSeasons.seasonNumber,
      maxProfessionLevel: schema.gameSeasons.maxProfessionLevel,
      maxBaseVr: schema.gameSeasons.maxBaseVr,
    })
    .from(schema.gameSeasons)
    .orderBy(asc(schema.gameSeasons.seasonNumber));

  return NextResponse.json({ seasons: rows });
}

export async function PATCH(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = parsePatchGameSeasonCapsBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const db = getDb();
  const [before] = await db
    .select({
      id: schema.gameSeasons.id,
      seasonNumber: schema.gameSeasons.seasonNumber,
      maxProfessionLevel: schema.gameSeasons.maxProfessionLevel,
      maxBaseVr: schema.gameSeasons.maxBaseVr,
    })
    .from(schema.gameSeasons)
    .where(eq(schema.gameSeasons.id, parsed.data.seasonId))
    .limit(1);

  if (!before) {
    return NextResponse.json({ error: "Season not found" }, { status: 404 });
  }

  const now = new Date();
  const [updated] = await db
    .update(schema.gameSeasons)
    .set({
      ...(parsed.data.maxBaseVr !== undefined
        ? { maxBaseVr: parsed.data.maxBaseVr }
        : {}),
      ...(parsed.data.maxProfessionLevel !== undefined
        ? { maxProfessionLevel: parsed.data.maxProfessionLevel }
        : {}),
      updatedAt: now,
    })
    .where(eq(schema.gameSeasons.id, parsed.data.seasonId))
    .returning({
      id: schema.gameSeasons.id,
      seasonNumber: schema.gameSeasons.seasonNumber,
      maxProfessionLevel: schema.gameSeasons.maxProfessionLevel,
      maxBaseVr: schema.gameSeasons.maxBaseVr,
    });

  if (!updated) {
    return NextResponse.json({ error: "Season not found" }, { status: 404 });
  }

  if (gameSeasonCapsChanged(before, updated)) {
    const [session] = await db
      .select({ hqUserId: schema.sessions.hqUserId })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);

    await writeAuditLog({
      sessionId,
      hqUserId: session?.hqUserId ?? undefined,
      action: "admin.game_season_caps_update",
      resourceType: "game_season",
      resourceId: updated.id,
      resourceName: `S${updated.seasonNumber}`,
      metadata: {
        before: {
          maxBaseVr: before.maxBaseVr,
          maxProfessionLevel: before.maxProfessionLevel,
        },
        after: {
          maxBaseVr: updated.maxBaseVr,
          maxProfessionLevel: updated.maxProfessionLevel,
        },
      },
    });
  }

  return NextResponse.json({ season: updated });
}
