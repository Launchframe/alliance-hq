import "server-only";

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { resolveSessionAllianceId } from "@/lib/alliance/session-memberships";
import { getDb, schema } from "@/lib/db";
import type { VideoJob } from "@/lib/db/schema";
import { loadSession } from "@/lib/session";
import { sessionCanProcessVideo } from "@/lib/video/processor-slots.server";
import { resolveHqAllianceIdFromStoredAllianceId } from "@/lib/video/video-job-alliance.server";

export type AllianceVideoJobOpsContext = {
  sessionId: string;
  allianceId: string;
};

export type AllianceVideoJobOpsDenied = NextResponse;

export async function requireAllianceVideoJobOps(
  sessionId: string | null | undefined,
): Promise<AllianceVideoJobOpsContext | AllianceVideoJobOpsDenied> {
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await sessionCanProcessVideo(sessionId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const session = await loadSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allianceId = resolveSessionAllianceId(session);
  if (!allianceId) {
    return NextResponse.json({ error: "No active alliance" }, { status: 400 });
  }

  return { sessionId, allianceId };
}

export function isAllianceVideoJobOpsDenied(
  result: AllianceVideoJobOpsContext | AllianceVideoJobOpsDenied,
): result is AllianceVideoJobOpsDenied {
  return result instanceof NextResponse;
}

export type AllianceScopedVideoJobResult =
  | { ok: true; job: VideoJob }
  | { ok: false; status: 404 };

/** Load a job only when it belongs to the session alliance (404 on mismatch). */
export async function loadAllianceScopedVideoJob(
  jobId: string,
  sessionAllianceId: string,
): Promise<AllianceScopedVideoJobResult> {
  const db = getDb();
  const [job] = await db
    .select()
    .from(schema.videoJobs)
    .where(eq(schema.videoJobs.id, jobId))
    .limit(1);

  if (!job) {
    return { ok: false, status: 404 };
  }

  const jobAllianceId = await resolveHqAllianceIdFromStoredAllianceId(
    job.allianceId,
  );
  if (!jobAllianceId || jobAllianceId !== sessionAllianceId) {
    return { ok: false, status: 404 };
  }

  return { ok: true, job };
}
