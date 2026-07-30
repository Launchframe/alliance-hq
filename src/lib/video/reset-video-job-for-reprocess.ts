import { and, eq, notInArray } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { emitVideoJobStatus } from "@/lib/events/video-jobs";
import {
  canReprocessVideoJob,
  VIDEO_JOB_REPROCESS_BLOCKED_STATUSES,
  videoJobReprocessInFlightMessage,
} from "@/lib/video/admin-job-actions";
import { videoJobStatusOwnerFields } from "@/lib/video/video-job-access.shared";

export type VideoJobReprocessProcessorBinding = {
  processingSessionId: string;
  approvedByHqUserId?: string | null;
  approvedAt: Date;
};

export type ResetVideoJobForReprocessOptions = {
  /** Bind the processor session in the same claim write as `queued`. */
  processorBinding?: VideoJobReprocessProcessorBinding;
};

export class VideoJobReprocessConflictError extends Error {
  readonly statusCode = 409;

  constructor(status: string) {
    super(videoJobReprocessInFlightMessage(status));
    this.name = "VideoJobReprocessConflictError";
  }
}

/**
 * Claim the job for reprocess (queued + clear parse pointer), then delete
 * orphaned parse/frame rows. The status claim is conditional so a concurrent
 * submit/extract cannot lose Ashed writes or review rows underfoot.
 */
export async function resetVideoJobForReprocess(
  jobId: string,
  options?: ResetVideoJobForReprocessOptions,
): Promise<void> {
  const db = getDb();
  const [job] = await db
    .select()
    .from(schema.videoJobs)
    .where(eq(schema.videoJobs.id, jobId))
    .limit(1);

  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  if (!canReprocessVideoJob(job.status)) {
    throw new VideoJobReprocessConflictError(job.status);
  }

  const parseSessionId = job.parseSessionId;
  const now = new Date();
  const claimFields: Partial<typeof schema.videoJobs.$inferInsert> = {
    status: "queued",
    parseSessionId: null,
    frameCount: null,
    uploadedFrameCount: 0,
    errorMessage: null,
    timingsJson: null,
    totalFileSizeBytes: null,
    updatedAt: now,
  };
  if (options?.processorBinding) {
    claimFields.processingSessionId =
      options.processorBinding.processingSessionId;
    claimFields.approvedByHqUserId =
      options.processorBinding.approvedByHqUserId ?? null;
    claimFields.approvedAt = options.processorBinding.approvedAt;
  }
  const claimed = await db
    .update(schema.videoJobs)
    .set(claimFields)
    .where(
      and(
        eq(schema.videoJobs.id, jobId),
        notInArray(schema.videoJobs.status, [
          ...VIDEO_JOB_REPROCESS_BLOCKED_STATUSES,
        ]),
      ),
    )
    .returning({ id: schema.videoJobs.id });

  if (claimed.length === 0) {
    const [fresh] = await db
      .select({ status: schema.videoJobs.status })
      .from(schema.videoJobs)
      .where(eq(schema.videoJobs.id, jobId))
      .limit(1);
    throw new VideoJobReprocessConflictError(fresh?.status ?? job.status);
  }

  if (parseSessionId) {
    await db
      .delete(schema.parsedRows)
      .where(eq(schema.parsedRows.parseSessionId, parseSessionId));
    await db
      .delete(schema.parseSessions)
      .where(eq(schema.parseSessions.id, parseSessionId));
  }

  await db.delete(schema.videoFrames).where(eq(schema.videoFrames.jobId, jobId));

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
