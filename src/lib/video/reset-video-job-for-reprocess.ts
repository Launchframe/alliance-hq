import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { emitVideoJobStatus } from "@/lib/events/video-jobs";
import { videoJobStatusOwnerFields } from "@/lib/video/video-job-access.shared";

export async function resetVideoJobForReprocess(jobId: string): Promise<void> {
  const db = getDb();
  const [job] = await db
    .select()
    .from(schema.videoJobs)
    .where(eq(schema.videoJobs.id, jobId))
    .limit(1);

  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  if (job.parseSessionId) {
    await db
      .delete(schema.parsedRows)
      .where(eq(schema.parsedRows.parseSessionId, job.parseSessionId));
    await db
      .delete(schema.parseSessions)
      .where(eq(schema.parseSessions.id, job.parseSessionId));
  }

  await db.delete(schema.videoFrames).where(eq(schema.videoFrames.jobId, jobId));

  await db
    .update(schema.videoJobs)
    .set({
      status: "queued",
      parseSessionId: null,
      frameCount: null,
      uploadedFrameCount: 0,
      errorMessage: null,
      timingsJson: null,
      totalFileSizeBytes: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.videoJobs.id, jobId));

  await emitVideoJobStatus({
    ...videoJobStatusOwnerFields(job),
    jobId,
    status: "queued",
    fileName: job.fileName,
    scoreTarget: job.scoreTarget ?? job.category,
    frameCount: null,
    uploadedFrameCount: 0,
    errorMessage: null,
  });
}
