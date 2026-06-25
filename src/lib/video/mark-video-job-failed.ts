import { eq } from "drizzle-orm";

import { writeAuditLog } from "@/lib/bff/audit";
import { getDb, schema } from "@/lib/db";
import { emitVideoJobStatus } from "@/lib/events/video-jobs";

/**
 * Mark a video job failed in the DB and notify SSE subscribers.
 * Safe to call when processing already failed inside {@link processVideoJob}
 * (no-op DB write if already failed; still re-emits for reconnecting clients).
 */
export async function markVideoJobFailed(
  jobId: string,
  errorMessage: string,
  options?: { audit?: boolean },
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

  const scoreTarget = job.scoreTarget ?? job.category ?? null;
  const updatedAt = new Date();
  const message = errorMessage.trim() || "Video processing failed";
  const shouldWriteDb =
    job.status !== "failed" || job.errorMessage !== message;

  if (shouldWriteDb) {
    await db
      .update(schema.videoJobs)
      .set({
        status: "failed",
        errorMessage: message,
        updatedAt,
      })
      .where(eq(schema.videoJobs.id, jobId));

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
  }

  await emitVideoJobStatus({
    sessionId: job.sessionId,
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
