import { NextResponse } from "next/server";

import { readSessionId } from "@/lib/session";
import { canReprocessVideoJob } from "@/lib/video/admin-job-actions";
import {
  AdminReprocessError,
  adminReprocessVideoJob,
} from "@/lib/video/admin-reprocess-extraction.server";
import {
  isAllianceVideoJobOpsDenied,
  loadAllianceScopedVideoJob,
  requireAllianceVideoJobOps,
} from "@/lib/video/alliance-video-jobs-access.server";
import { dispatchVideoProcessing } from "@/lib/video/trigger-processing";

type Props = {
  params: Promise<{ jobId: string }>;
};

export async function POST(request: Request, { params }: Props) {
  const sessionId = await readSessionId();
  const ops = await requireAllianceVideoJobOps(sessionId);
  if (isAllianceVideoJobOpsDenied(ops)) return ops;

  const { jobId } = await params;
  const access = await loadAllianceScopedVideoJob(jobId, ops.allianceId);
  if (!access.ok) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (!canReprocessVideoJob(access.job.status)) {
    return NextResponse.json(
      {
        error: `Cannot reprocess job in status "${access.job.status}" while processing is in flight.`,
      },
      { status: 409 },
    );
  }

  let body: unknown = {};
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }
  }

  try {
    const result = await adminReprocessVideoJob({
      jobId,
      sessionId: ops.sessionId,
      body,
    });
    dispatchVideoProcessing(jobId, { source: "reprocess" });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof AdminReprocessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
