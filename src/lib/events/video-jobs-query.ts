import { and, desc, eq, ne } from "drizzle-orm";

import type { VideoJobStatusEvent } from "@/lib/events/video-jobs-types";
import { defaultStageForJobStatus } from "@/lib/video/video-job-stage.shared";
import { getDb, schema } from "@/lib/db";
import { videoJobsOwnedByViewerInAllianceWhere } from "@/lib/video/video-job-ownership.server";

export async function getRecentOwnedVideoJobs(
  sessionId: string,
  hqUserId: string | null,
  options?: { limit?: number; currentAllianceId?: string | null },
): Promise<VideoJobStatusEvent[]> {
  const limit = options?.limit ?? 20;
  const currentAllianceId = options?.currentAllianceId ?? null;
  const db = getDb();
  const jobs = await db
    .select()
    .from(schema.videoJobs)
    .where(
      and(
        videoJobsOwnedByViewerInAllianceWhere(
          sessionId,
          hqUserId,
          currentAllianceId,
        ),
        ne(schema.videoJobs.status, "discarded"),
        ne(schema.videoJobs.status, "pending_upload"),
      ),
    )
    .orderBy(desc(schema.videoJobs.updatedAt))
    .limit(limit);

  const events: VideoJobStatusEvent[] = [];

  for (const job of jobs) {
    let rowCount: number | null = null;
    let matchedCount: number | null = null;

    if (job.parseSessionId) {
      const [parseSession] = await db
        .select()
        .from(schema.parseSessions)
        .where(eq(schema.parseSessions.id, job.parseSessionId))
        .limit(1);
      if (parseSession) {
        rowCount = parseSession.rowCount;
        matchedCount = parseSession.matchedCount;
      }
    }

    events.push({
      sessionId: job.sessionId,
      enqueuedByHqUserId: job.enqueuedByHqUserId,
      hqUserId: job.hqUserId,
      allianceId: job.allianceId,
      jobId: job.id,
      status: job.status,
      fileName: job.fileName,
      scoreTarget: job.scoreTarget ?? job.category,
      frameCount: job.frameCount,
      uploadedFrameCount: job.uploadedFrameCount,
      rowCount,
      matchedCount,
      errorMessage: job.errorMessage,
      stage: defaultStageForJobStatus(job.status) ?? undefined,
      updatedAt: job.updatedAt.toISOString(),
    });
  }

  return events;
}

/** @deprecated Prefer {@link getRecentOwnedVideoJobs} for cross-device lists. */
export async function getRecentSessionVideoJobs(
  sessionId: string,
  limit = 20,
): Promise<VideoJobStatusEvent[]> {
  return getRecentOwnedVideoJobs(sessionId, null, { limit });
}

export async function getVideoJobStatusEvent(
  jobId: string,
): Promise<VideoJobStatusEvent | null> {
  const db = getDb();
  const [job] = await db
    .select()
    .from(schema.videoJobs)
    .where(eq(schema.videoJobs.id, jobId))
    .limit(1);

  if (!job) {
    return null;
  }

  let rowCount: number | null = null;
  let matchedCount: number | null = null;

  if (job.parseSessionId) {
    const [parseSession] = await db
      .select()
      .from(schema.parseSessions)
      .where(eq(schema.parseSessions.id, job.parseSessionId))
      .limit(1);
    if (parseSession) {
      rowCount = parseSession.rowCount;
      matchedCount = parseSession.matchedCount;
    }
  }

  return {
    sessionId: job.sessionId,
    enqueuedByHqUserId: job.enqueuedByHqUserId,
    hqUserId: job.hqUserId,
    allianceId: job.allianceId,
    jobId: job.id,
    status: job.status,
    fileName: job.fileName,
    scoreTarget: job.scoreTarget ?? job.category,
    frameCount: job.frameCount,
    uploadedFrameCount: job.uploadedFrameCount,
    rowCount,
    matchedCount,
    errorMessage: job.errorMessage,
    stage: defaultStageForJobStatus(job.status) ?? undefined,
    updatedAt: job.updatedAt.toISOString(),
  };
}
