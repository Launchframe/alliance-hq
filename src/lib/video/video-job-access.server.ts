import "server-only";

import { and, eq, isNull, or } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import type { VideoJob, VideoUploadGroup } from "@/lib/db/schema";
import { loadSession } from "@/lib/session";
import {
  sessionCanAccessAllianceVideoJob,
  sessionCanProcessVideoForAlliance,
} from "@/lib/video/processor-slots.server";
import {
  isVideoJobAccessibleViaSession,
  isVideoJobOwningHqUser,
} from "@/lib/video/video-job-access.shared";

export type VideoJobAccessLevel = "read" | "mutate" | "process";

export type VideoJobAccessResult =
  | { ok: true; job: VideoJob }
  | { ok: false; status: 403 | 404 };

/**
 * Alliance-scoped access to video jobs for cross-device review and queue handoff.
 * Uploader session remains allowed for legacy jobs without allianceId.
 */
export async function resolveVideoJobAccess(
  jobId: string,
  sessionId: string,
  level: VideoJobAccessLevel,
): Promise<VideoJobAccessResult> {
  const db = getDb();
  const [job] = await db
    .select()
    .from(schema.videoJobs)
    .where(eq(schema.videoJobs.id, jobId))
    .limit(1);

  if (!job) {
    return { ok: false, status: 404 };
  }

  const session = await loadSession(sessionId);
  if (!session) {
    return { ok: false, status: 403 };
  }

  const isUploaderSession = isVideoJobAccessibleViaSession(
    sessionId,
    session.hqUserId,
    job,
  );
  const isOwningHqUser = isVideoJobOwningHqUser(session.hqUserId, job);

  if (!job.allianceId) {
    if (isUploaderSession || isOwningHqUser) {
      return { ok: true, job };
    }
    return { ok: false, status: 404 };
  }

  const allianceId = job.allianceId;

  if (level === "process") {
    if (!(await sessionCanProcessVideoForAlliance(sessionId, allianceId))) {
      return { ok: false, status: 403 };
    }
    return { ok: true, job };
  }

  if (isUploaderSession || isOwningHqUser) {
    return { ok: true, job };
  }

  if (
    !(await sessionCanAccessAllianceVideoJob(sessionId, allianceId, {
      enqueuedByHqUserId: job.enqueuedByHqUserId,
    }))
  ) {
    return { ok: false, status: 404 };
  }

  return { ok: true, job };
}

/**
 * Uploader-only access (any device signed in as the same HQ user).
 * Alliance processors are not included — use {@link resolveVideoJobAccess}.
 */
export async function resolveVideoJobUploaderAccess(
  jobId: string,
  sessionId: string,
): Promise<VideoJobAccessResult> {
  const db = getDb();
  const [job] = await db
    .select()
    .from(schema.videoJobs)
    .where(eq(schema.videoJobs.id, jobId))
    .limit(1);

  if (!job) {
    return { ok: false, status: 404 };
  }

  const session = await loadSession(sessionId);
  if (!session) {
    return { ok: false, status: 403 };
  }

  if (
    isVideoJobOwningHqUser(session.hqUserId, job) ||
    isVideoJobAccessibleViaSession(sessionId, session.hqUserId, job)
  ) {
    return { ok: true, job };
  }

  return { ok: false, status: 404 };
}

export type VideoUploadGroupAccessResult =
  | { ok: true; group: VideoUploadGroup }
  | { ok: false; status: 403 | 404 };

/**
 * Alliance-scoped access to a multi-pass upload group. Delegates to the primary
 * job when present.
 *
 * When `primaryJobId` is null (pending_upload before activatePendingVideoUpload),
 * delegates to the group's primary pass job row when present; otherwise only the
 * uploader browser session may access the group.
 */
export async function resolveVideoUploadGroupAccess(
  groupId: string,
  sessionId: string,
  level: VideoJobAccessLevel,
): Promise<VideoUploadGroupAccessResult> {
  const db = getDb();
  const [group] = await db
    .select()
    .from(schema.videoUploadGroups)
    .where(eq(schema.videoUploadGroups.id, groupId))
    .limit(1);

  if (!group) {
    return { ok: false, status: 404 };
  }

  if (group.primaryJobId) {
    const jobAccess = await resolveVideoJobAccess(
      group.primaryJobId,
      sessionId,
      level,
    );
    if (!jobAccess.ok) {
      return jobAccess;
    }
    return { ok: true, group };
  }

  const [linkedPrimaryJob] = await db
    .select({ id: schema.videoJobs.id })
    .from(schema.videoJobs)
    .where(
      and(
        eq(schema.videoJobs.groupId, groupId),
        or(
          eq(schema.videoJobs.passRole, "primary"),
          isNull(schema.videoJobs.passRole),
        ),
      ),
    )
    .limit(1);

  if (linkedPrimaryJob) {
    const jobAccess = await resolveVideoJobAccess(
      linkedPrimaryJob.id,
      sessionId,
      level,
    );
    if (!jobAccess.ok) {
      return jobAccess;
    }
    return { ok: true, group };
  }

  const session = await loadSession(sessionId);
  if (!session) {
    return { ok: false, status: 403 };
  }

  const isUploaderSession = group.sessionId === sessionId;
  const allianceId = group.allianceId;

  if (!allianceId) {
    if (isUploaderSession) {
      return { ok: true, group };
    }
    return { ok: false, status: 404 };
  }

  if (level === "process") {
    if (!(await sessionCanProcessVideoForAlliance(sessionId, allianceId))) {
      return { ok: false, status: 403 };
    }
    return { ok: true, group };
  }

  if (isUploaderSession) {
    return { ok: true, group };
  }

  if (
    !(await sessionCanAccessAllianceVideoJob(sessionId, allianceId))
  ) {
    return { ok: false, status: 404 };
  }

  return { ok: true, group };
}

export function videoJobAccessErrorResponse(result: {
  ok: false;
  status: 403 | 404;
}): Response {
  if (result.status === 403) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return Response.json({ error: "Job not found" }, { status: 404 });
}
