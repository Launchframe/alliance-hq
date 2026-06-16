import { NextResponse } from "next/server";
import { and, isNotNull, isNull } from "drizzle-orm";

import { applySeasonSync } from "@/lib/game-season/sync";
import { getDb, schema } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorize(request: Request): boolean {
  const auth = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET?.trim();
  return Boolean(cronSecret && auth === `Bearer ${cronSecret}`);
}

export async function GET(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();
  const alliances = await db
    .select({
      id: schema.alliances.id,
      gameServerNumber: schema.alliances.gameServerNumber,
    })
    .from(schema.alliances)
    .where(
      and(
        isNotNull(schema.alliances.gameServerNumber),
        isNull(schema.alliances.seasonKeyOverride),
      ),
    );

  const results: Array<{
    allianceId: string;
    ok: boolean;
    seasonKey?: string;
    source?: string;
    error?: string;
  }> = [];

  for (const alliance of alliances) {
    try {
      const effective = await applySeasonSync(alliance.id);
      results.push({
        allianceId: alliance.id,
        ok: true,
        seasonKey: effective.seasonKey,
        source: effective.source,
      });
    } catch (error) {
      results.push({
        allianceId: alliance.id,
        ok: false,
        error: error instanceof Error ? error.message : "sync failed",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    synced: results.filter((row) => row.ok).length,
    failed: results.filter((row) => !row.ok).length,
    results,
  });
}
