import { NextResponse } from "next/server";

import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";
import { findAdminVideoJobNeighborIds } from "@/lib/video/admin-video-job-neighbors.shared";
import {
  listAdminVideoJobIds,
  parseAdminVideoJobsListQuery,
} from "@/lib/video/admin-video-jobs-list.server";

type RouteParams = { params: Promise<{ jobId: string }> };

/**
 * GET /api/admin/video-jobs/[jobId]/neighbors
 * Adjacent jobs in the filtered admin index (grouped primary+shadow,
 * newest groups first, same limit window).
 */
export async function GET(request: Request, { params }: RouteParams) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const { jobId } = await params;
  const url = new URL(request.url);
  // Detail UI uses the same 200-cap window as the index page.
  if (!url.searchParams.has("limit")) {
    url.searchParams.set("limit", "200");
  }
  const query = parseAdminVideoJobsListQuery(url.searchParams);
  const orderedIds = await listAdminVideoJobIds(query);
  const neighbors = findAdminVideoJobNeighborIds(orderedIds, jobId);
  const index = orderedIds.indexOf(jobId);

  return NextResponse.json({
    previousId: neighbors.previousId,
    nextId: neighbors.nextId,
    position: index >= 0 ? index + 1 : null,
    total: orderedIds.length,
  });
}
