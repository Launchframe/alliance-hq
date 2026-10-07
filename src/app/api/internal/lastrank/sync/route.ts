import { NextResponse } from "next/server";

import { listLastRankAutoSyncTargets } from "@/lib/lastrank/sync-registry.shared";
import { syncLastRankAlliance } from "@/lib/lastrank/sync-alliance.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function authorize(request: Request): boolean {
  const auth = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET?.trim();
  return Boolean(cronSecret && auth === `Bearer ${cronSecret}`);
}

export async function GET(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const targets = listLastRankAutoSyncTargets();
  if (targets.length === 0) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "no autoSync alliances in LASTRANK_SYNC_REGISTRY",
    });
  }

  const apply = new URL(request.url).searchParams.get("dryRun") !== "1";
  const results = [];
  for (const target of targets) {
    try {
      const synced = await syncLastRankAlliance({
        target,
        apply,
      });
      results.push({
        tag: synced.tag,
        ok: true,
        lastRankCount: synced.lastRankCount,
        matched: synced.match.matched.length,
        unmatched: synced.match.unmatched.length,
        apply: synced.apply,
      });
    } catch (error) {
      results.push({
        tag: target.tag,
        ok: false,
        error: error instanceof Error ? error.message : "sync failed",
      });
    }
  }

  return NextResponse.json({
    ok: results.every((row) => row.ok),
    apply,
    results,
  });
}
