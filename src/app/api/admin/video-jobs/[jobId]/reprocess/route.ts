import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";
import { canReprocessVideoJob } from "@/lib/video/admin-job-actions";
import {
  AdminReprocessError,
  adminReprocessVideoJob,
} from "@/lib/video/admin-reprocess-extraction.server";
import { dispatchVideoProcessing } from "@/lib/video/trigger-processing";

type Props = {
  params: Promise<{ jobId: string }>;
};

export async function POST(request: Request, { params }: Props) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const { jobId } = await params;
  const db = getDb();
  const [job] = await db
    .select({ id: schema.videoJobs.id, status: schema.videoJobs.status })
    .from(schema.videoJobs)
    .where(eq(schema.videoJobs.id, jobId))
    .limit(1);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (!canReprocessVideoJob(job.status)) {
    return NextResponse.json(
      {
        error: `Cannot reprocess job in status "${job.status}" while processing is in flight.`,
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
      sessionId,
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
