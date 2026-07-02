import "server-only";

import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";

import { resolveSessionAllianceId } from "@/lib/alliance/session-memberships";
import { getDb, schema } from "@/lib/db";
import { loadSession } from "@/lib/session";
import { sessionCanReadAllianceVideoQueue } from "@/lib/video/processor-slots.server";
import { ACTIVE_QUEUE_VIDEO_JOB_STATUSES } from "@/lib/video/video-lifecycle.shared";
import type { AllianceQueueJob } from "@/lib/video/video-queue.shared";

export type { AllianceQueueJob } from "@/lib/video/video-queue.shared";

const primaryPassFilter = or(
  eq(schema.videoJobs.passRole, "primary"),
  isNull(schema.videoJobs.passRole),
);

const activeStatusFilter = inArray(schema.videoJobs.status, [
  ...ACTIVE_QUEUE_VIDEO_JOB_STATUSES,
]);

function mapQueueRows(
  rows: Array<{
    id: string;
    status: string;
    fileName: string | null;
    scoreTarget: string | null;
    category: string | null;
    boardKey: string | null;
    createdAt: Date;
    frameCount: number | null;
    uploadedFrameCount: number | null;
    errorMessage: string | null;
    enqueuedByName: string | null;
    enqueuedByEmail: string | null;
  }>,
): AllianceQueueJob[] {
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    fileName: row.fileName,
    scoreTarget: row.scoreTarget ?? row.category,
    boardKey: row.boardKey,
    enqueuedBy: row.enqueuedByName ?? row.enqueuedByEmail ?? null,
    createdAt: row.createdAt.toISOString(),
    frameCount: row.frameCount,
    uploadedFrameCount: row.uploadedFrameCount,
    errorMessage: row.errorMessage,
  }));
}

async function selectActiveQueueJobs(
  whereClause: ReturnType<typeof and>,
): Promise<AllianceQueueJob[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.videoJobs.id,
      status: schema.videoJobs.status,
      fileName: schema.videoJobs.fileName,
      scoreTarget: schema.videoJobs.scoreTarget,
      category: schema.videoJobs.category,
      boardKey: schema.videoJobs.boardKey,
      createdAt: schema.videoJobs.createdAt,
      frameCount: schema.videoJobs.frameCount,
      uploadedFrameCount: schema.videoJobs.uploadedFrameCount,
      errorMessage: schema.videoJobs.errorMessage,
      enqueuedByName: schema.hqUsers.displayName,
      enqueuedByEmail: schema.hqUsers.email,
    })
    .from(schema.videoJobs)
    .leftJoin(
      schema.hqUsers,
      eq(schema.hqUsers.id, schema.videoJobs.enqueuedByHqUserId),
    )
    .where(and(whereClause, activeStatusFilter, primaryPassFilter))
    .orderBy(desc(schema.videoJobs.createdAt));

  return mapQueueRows(rows);
}

/** All alliance jobs that still need action before scores are submitted. */
export async function listAllianceActiveVideoJobs(
  allianceId: string,
): Promise<AllianceQueueJob[]> {
  return selectActiveQueueJobs(eq(schema.videoJobs.allianceId, allianceId));
}

/** Jobs enqueued by this HQ user (used when alliance context is unset). */
export async function listEnqueuerActiveVideoJobs(
  hqUserId: string,
): Promise<AllianceQueueJob[]> {
  return selectActiveQueueJobs(
    eq(schema.videoJobs.enqueuedByHqUserId, hqUserId),
  );
}

/**
 * Action-required jobs for the signed-in session (alliance-wide when context
 * is known, otherwise jobs this user enqueued (requires enqueue permission in
 * some alliance when session alliance context is unset).
 */
export async function listVideoQueueJobsForSession(
  sessionId: string,
): Promise<AllianceQueueJob[]> {
  const session = await loadSession(sessionId);
  if (!session) {
    return [];
  }

  if (!(await sessionCanReadAllianceVideoQueue(sessionId, session))) {
    return [];
  }

  const allianceId = resolveSessionAllianceId(session);
  if (allianceId) {
    return listAllianceActiveVideoJobs(allianceId);
  }

  if (session.hqUserId) {
    return listEnqueuerActiveVideoJobs(session.hqUserId);
  }

  return [];
}

/** @deprecated Use listAllianceActiveVideoJobs */
export async function listAlliancePendingVideoJobs(
  allianceId: string,
): Promise<AllianceQueueJob[]> {
  return listAllianceActiveVideoJobs(allianceId);
}
