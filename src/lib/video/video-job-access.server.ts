import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import type { VideoJob } from "@/lib/db/schema";
import { loadSession } from "@/lib/session";
import {
  sessionCanProcessVideo,
  sessionCanReadAllianceVideoQueue,
} from "@/lib/video/processor-slots.server";

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

  const isUploaderSession = job.sessionId === sessionId;

  if (!job.allianceId) {
    if (isUploaderSession) {
      return { ok: true, job };
    }
    return { ok: false, status: 404 };
  }

  if (session.currentAllianceId !== job.allianceId) {
    return { ok: false, status: 404 };
  }

  if (level === "process") {
    if (!(await sessionCanProcessVideo(sessionId))) {
      return { ok: false, status: 403 };
    }
    return { ok: true, job };
  }

  if (isUploaderSession) {
    return { ok: true, job };
  }

  if (!(await sessionCanReadAllianceVideoQueue(sessionId))) {
    return { ok: false, status: 403 };
  }

  return { ok: true, job };
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
