import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";
import { canReprocessVideoJob } from "@/lib/video/admin-job-actions";
import { resetVideoJobForReprocess } from "@/lib/video/reset-video-job-for-reprocess";
import { dispatchVideoProcessing } from "@/lib/video/trigger-processing";

type Props = {
  params: Promise<{ jobId: string }>;
};

export async function POST(_request: Request, { params }: Props) {
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

  await resetVideoJobForReprocess(jobId);
  dispatchVideoProcessing(jobId, { source: "reprocess" });

  return NextResponse.json({ ok: true, jobId, status: "queued" });
}
