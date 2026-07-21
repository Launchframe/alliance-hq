import { NextResponse } from "next/server";

import { readSessionId } from "@/lib/session";
import {
  isAllianceVideoJobOpsDenied,
  requireAllianceVideoJobOps,
} from "@/lib/video/alliance-video-jobs-access.server";
import { loadVideoJobsAnalytics } from "@/lib/video/video-jobs-analytics.server";

export async function GET(request: Request) {
  const sessionId = await readSessionId();
  const ops = await requireAllianceVideoJobOps(sessionId);
  if (isAllianceVideoJobOpsDenied(ops)) return ops;

  const url = new URL(request.url);
  const scoreTargetFilter = url.searchParams.get("scoreTarget");
  const passKeyFilter = url.searchParams.get("passKey");
  const days = Number(url.searchParams.get("days") ?? 0);

  const response = await loadVideoJobsAnalytics({
    scoreTarget: scoreTargetFilter,
    passKey: passKeyFilter,
    days,
    allianceId: ops.allianceId,
  });

  return NextResponse.json(response);
}
