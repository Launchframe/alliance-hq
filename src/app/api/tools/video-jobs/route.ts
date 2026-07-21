import { NextResponse } from "next/server";

import {
  isAllianceVideoJobOpsDenied,
  requireAllianceVideoJobOps,
} from "@/lib/video/alliance-video-jobs-access.server";
import {
  listAdminVideoJobs,
  parseAdminVideoJobsListQuery,
} from "@/lib/video/admin-video-jobs-list.server";
import { readSessionId } from "@/lib/session";

export async function GET(request: Request) {
  const sessionId = await readSessionId();
  const ops = await requireAllianceVideoJobOps(sessionId);
  if (isAllianceVideoJobOpsDenied(ops)) return ops;

  const url = new URL(request.url);
  const query = parseAdminVideoJobsListQuery(url.searchParams);
  const rows = await listAdminVideoJobs({
    ...query,
    allianceId: ops.allianceId,
  });

  return NextResponse.json({ jobs: rows });
}
