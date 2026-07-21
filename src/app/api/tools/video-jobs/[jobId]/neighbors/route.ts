import { NextResponse } from "next/server";

import { readSessionId } from "@/lib/session";
import { findAdminVideoJobNeighborIds } from "@/lib/video/admin-video-job-neighbors.shared";
import {
  isAllianceVideoJobOpsDenied,
  loadAllianceScopedVideoJob,
  requireAllianceVideoJobOps,
} from "@/lib/video/alliance-video-jobs-access.server";
import {
  listAdminVideoJobIds,
  parseAdminVideoJobsListQuery,
} from "@/lib/video/admin-video-jobs-list.server";

type RouteParams = { params: Promise<{ jobId: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  const sessionId = await readSessionId();
  const ops = await requireAllianceVideoJobOps(sessionId);
  if (isAllianceVideoJobOpsDenied(ops)) return ops;

  const { jobId } = await params;
  const access = await loadAllianceScopedVideoJob(jobId, ops.allianceId);
  if (!access.ok) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  if (!url.searchParams.has("limit")) {
    url.searchParams.set("limit", "200");
  }
  const query = parseAdminVideoJobsListQuery(url.searchParams);
  const orderedIds = await listAdminVideoJobIds({
    ...query,
    allianceId: ops.allianceId,
  });
  const neighbors = findAdminVideoJobNeighborIds(orderedIds, jobId);
  const index = orderedIds.indexOf(jobId);

  return NextResponse.json({
    previousId: neighbors.previousId,
    nextId: neighbors.nextId,
    position: index >= 0 ? index + 1 : null,
    total: orderedIds.length,
  });
}
