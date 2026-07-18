import { NextResponse } from "next/server";

import {
  listAdminVideoJobs,
  parseAdminVideoJobsListQuery,
} from "@/lib/video/admin-video-jobs-list.server";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

export async function GET(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const url = new URL(request.url);
  const query = parseAdminVideoJobsListQuery(url.searchParams);
  const rows = await listAdminVideoJobs(query);

  return NextResponse.json({ jobs: rows });
}
