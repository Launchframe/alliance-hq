import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { readSessionId } from "@/lib/session";
import { canRequeueVideoJob } from "@/lib/video/admin-job-actions";
import {
  isAllianceVideoJobOpsDenied,
  loadAllianceScopedVideoJob,
  requireAllianceVideoJobOps,
} from "@/lib/video/alliance-video-jobs-access.server";
import { VIDEO_JOB_CLAIMABLE_STATUSES } from "@/lib/video/claim-video-job-for-processing.server";
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
  // CAS: only demote back to queued when still claimable. A bare id update can
  // race the worker claim (queued→extracting) or a finished review and force
  // a second OCR that wipes successful parse state via unguarded setStatus.
  const [claimed] = await db
    .update(schema.videoJobs)
    .set({
      status: "queued",
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.videoJobs.id, jobId),
        inArray(schema.videoJobs.status, [...VIDEO_JOB_CLAIMABLE_STATUSES]),
      ),
    )
    .returning({ id: schema.videoJobs.id });

  if (!claimed) {
    const [fresh] = await db
      .select({ status: schema.videoJobs.status })
      .from(schema.videoJobs)
      .where(eq(schema.videoJobs.id, jobId))
      .limit(1);
    return NextResponse.json(
      {
        error: `Cannot requeue job in status "${fresh?.status ?? job.status}". Use reprocess for review jobs or wait until processing finishes.`,
      },
      { status: 409 },
    );
  }

  await dispatchVideoProcessing(jobId, { source: "admin-requeue" });

  return NextResponse.json({ ok: true, jobId, status: "queued" });
}
