import { NextResponse } from "next/server";

import { readSessionId } from "@/lib/session";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { clampVideoJobsAnalyticsDays } from "@/lib/video/video-jobs-analytics.server";
import { loadUploaderScoreTargetRewards } from "@/lib/video/video-hygiene-instrumentation.server";

/**
 * Platform-maintainer aggregates for the video hygiene learning loop
 * (uploader × scoreTarget reward signals).
 */
export async function GET(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const url = new URL(request.url);
  const days = clampVideoJobsAnalyticsDays(
    Number(url.searchParams.get("days") ?? "30"),
  );
  const hqUserId = url.searchParams.get("hqUserId");
  const scoreTarget = url.searchParams.get("scoreTarget");

  const rows = await loadUploaderScoreTargetRewards({
    days,
    hqUserId: hqUserId || null,
    scoreTarget: scoreTarget || null,
  });

  return NextResponse.json({ days, rows });
}
