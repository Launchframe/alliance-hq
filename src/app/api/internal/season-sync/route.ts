import { NextResponse } from "next/server";

import { applyGameServerSeasonSync } from "@/lib/game-season/sync";
import {
  ensureGameServersForSeasonCron,
  listGameServersForSeasonCron,
} from "@/lib/game-season/game-servers.server";

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

  await ensureGameServersForSeasonCron();
  const servers = await listGameServersForSeasonCron();

  const results: Array<{
    gameServerId: string;
    serverNumber: number;
    ok: boolean;
    seasonKey?: string;
    source?: string;
    error?: string;
  }> = [];

  for (const server of servers) {
    try {
      const effective = await applyGameServerSeasonSync(
        server.id,
        server.serverNumber,
      );
      results.push({
        gameServerId: server.id,
        serverNumber: server.serverNumber,
        ok: true,
        seasonKey: effective.seasonKey,
        source: effective.source,
      });
    } catch (error) {
      results.push({
        gameServerId: server.id,
        serverNumber: server.serverNumber,
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
