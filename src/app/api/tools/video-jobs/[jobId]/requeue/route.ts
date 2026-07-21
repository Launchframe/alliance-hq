import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { readSessionId } from "@/lib/session";
import { canRequeueVideoJob } from "@/lib/video/admin-job-actions";
import {
  isAllianceVideoJobOpsDenied,
  loadAllianceScopedVideoJob,
  requireAllianceVideoJobOps,
} from "@/lib/video/alliance-video-jobs-access.server";
import { dispatchVideoProcessing } from "@/lib/video/trigger-processing";

type Props = {
  params: Promise<{ jobId: string }>;
};

export async function POST(_request: Request, { params }: Props) {
  const sessionId = await readSessionId();
  const ops = await requireAllianceVideoJobOps(sessionId);
  if (isAllianceVideoJobOpsDenied(ops)) return ops;

  const { jobId } = await params;
  const access = await loadAllianceScopedVideoJob(jobId, ops.allianceId);
  if (!access.ok) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const job = access.job;
  if (!canRequeueVideoJob(job.status)) {
    return NextResponse.json(
      {
        error: `Cannot requeue job in status "${job.status}". Use reprocess for review jobs or wait until processing finishes.`,
      },
      { status: 409 },
    );
  }

  const db = getDb();
  await db
    .update(schema.videoJobs)
    .set({
      status: "queued",
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.videoJobs.id, jobId));

  await dispatchVideoProcessing(jobId, { source: "admin-requeue" });

  return NextResponse.json({ ok: true, jobId, status: "queued" });
}
