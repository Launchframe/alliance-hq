import { NextResponse } from "next/server";

import { parseScreenshotOcrJobsListQuery } from "@/lib/admin/screenshot-ocr-jobs.shared";
import { listScreenshotOcrJobs } from "@/lib/admin/screenshot-ocr-jobs.server";
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
  const query = parseScreenshotOcrJobsListQuery(url.searchParams);
  const { jobs, total } = await listScreenshotOcrJobs(query);

  return NextResponse.json({
    jobs,
    total,
    limit: query.limit,
    offset: query.offset,
  });
}
