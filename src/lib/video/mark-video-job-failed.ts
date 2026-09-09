import { and, eq, inArray, notInArray } from "drizzle-orm";

import { writeAuditLog } from "@/lib/bff/audit";
import { getDb, schema } from "@/lib/db";
import { emitVideoJobStatus } from "@/lib/events/video-jobs";
import { videoJobStatusOwnerFields } from "@/lib/video/video-job-access.shared";
import {
  isVideoJobFailProtectedStatus,
  VIDEO_JOB_FAIL_PROTECTED_STATUSES,
} from "@/lib/video/video-lifecycle.shared";

/**
 * Mark a video job failed in the DB and notify SSE subscribers.
 * Safe to call when processing already failed inside {@link processVideoJob}
 * (no-op DB write if already failed; still re-emits for reconnecting clients).
 * Never overwrites review/complete/submitting/discarded — a losing duplicate
 * worker or stale sweeper must not wipe a successful parse (CAS update).
 */
export async function markVideoJobFailed(
  jobId: string,
  errorMessage: string,
  options?: { audit?: boolean; onlyIfStatuses?: readonly string[] },
): Promise<boolean> {
  const db = getDb();
  const [job] = await db
    .select()
    .from(schema.videoJobs)
    .where(eq(schema.videoJobs.id, jobId))
    .limit(1);

  if (!job) {
    return false;
  }

  if (isVideoJobFailProtectedStatus(job.status)) {
    return false;
  }

  if (
    options?.onlyIfStatuses &&
    !options.onlyIfStatuses.includes(job.status)
  ) {
    return false;
  }

  const scoreTarget = job.scoreTarget ?? job.category ?? null;
  const updatedAt = new Date();
  const message = errorMessage.trim() || "Video processing failed";
  const alreadyFailedSameMessage =
    job.status === "failed" && job.errorMessage === message;

  if (alreadyFailedSameMessage) {
    await emitVideoJobStatus({
      ...videoJobStatusOwnerFields(job),
      jobId,
      status: "failed",
      fileName: job.fileName,
      scoreTarget,
      frameCount: job.frameCount,
      uploadedFrameCount: job.uploadedFrameCount,
      errorMessage: message,
      updatedAt: updatedAt.toISOString(),
    });
    return true;
  }

  // CAS: status predicates on the UPDATE so a concurrent flip to review/
  // complete/submitting/discarded cannot be overwritten by a stale read.
  const statusGuards = [
    notInArray(schema.videoJobs.status, [
      ...VIDEO_JOB_FAIL_PROTECTED_STATUSES,
    ]),
  ];
  if (options?.onlyIfStatuses) {
    statusGuards.push(
      inArray(schema.videoJobs.status, [...options.onlyIfStatuses]),
    );
  }

  const [updated] = await db
    .update(schema.videoJobs)
    .set({
      status: "failed",
      errorMessage: message,
      updatedAt,
    })
    .where(and(eq(schema.videoJobs.id, jobId), ...statusGuards))
    .returning({ id: schema.videoJobs.id });

  if (!updated) {
    return false;
  }

  if (options?.audit !== false && job.status !== "failed") {
    await writeAuditLog({
      sessionId: job.sessionId,
      allianceId: job.allianceId,
      action: "video.failed",
      resourceType: "video_job",
      resourceId: jobId,
      metadata: { error: message },
    });
  }

  await emitVideoJobStatus({
    ...videoJobStatusOwnerFields(job),
    jobId,
    status: "failed",
    fileName: job.fileName,
    scoreTarget,
    frameCount: job.frameCount,
    uploadedFrameCount: job.uploadedFrameCount,
    errorMessage: message,
    updatedAt: updatedAt.toISOString(),
  });

  return true;
}
