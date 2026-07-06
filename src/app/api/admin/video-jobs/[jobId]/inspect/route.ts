import { NextResponse } from "next/server";

import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";
import { loadVideoJobInspectReport } from "@/lib/video/video-job-inspect.server";

type RouteParams = { params: Promise<{ jobId: string }> };

/** Read-only ops diagnostics — same payload as `scripts/inspect-video-job.ts`. */
export async function GET(_request: Request, { params }: RouteParams) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const { jobId } = await params;
  const report = await loadVideoJobInspectReport(jobId);

  if (!report) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({ report });
}
