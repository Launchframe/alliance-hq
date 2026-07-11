import "server-only";

import { and, inArray, lt } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { markVideoJobFailed } from "@/lib/video/mark-video-job-failed";

/**
 * Vercel video worker `maxDuration` is 300s. Jobs still in extracting/parsing
 * past this window were almost certainly killed (timeout/OOM/SIGKILL) before
 * catch handlers could mark them failed — leaving the UI stuck on
 * "Processing (parsing)…".
 */
export const VIDEO_IN_FLIGHT_STALE_MS = 6 * 60 * 1000;

export const STALE_IN_FLIGHT_VIDEO_STATUSES = ["extracting", "parsing"] as const;

export const STALE_IN_FLIGHT_FAILURE_MESSAGE =
  "Worker timed out or crashed during processing. Requeue to try again.";

export function isVideoInFlightStale(
  updatedAt: Date | string | null | undefined,
  nowMs = Date.now(),
  staleAfterMs = VIDEO_IN_FLIGHT_STALE_MS,
): boolean {
  if (!updatedAt) return false;
  const updatedMs =
    typeof updatedAt === "string"
      ? new Date(updatedAt).getTime()
      : updatedAt.getTime();
  if (!Number.isFinite(updatedMs)) return false;
  return nowMs - updatedMs >= staleAfterMs;
}

/**
 * Mark extracting/parsing jobs whose `updated_at` is older than the stale
 * threshold as failed so SSE/UI leave the in-progress state and requeue works.
 */
export async function failStaleInFlightVideoJobs(options?: {
  nowMs?: number;
  staleAfterMs?: number;
  limit?: number;
}): Promise<{ failedJobIds: string[] }> {
  const nowMs = options?.nowMs ?? Date.now();
  const staleAfterMs = options?.staleAfterMs ?? VIDEO_IN_FLIGHT_STALE_MS;
  const limit = options?.limit ?? 25;
  const cutoff = new Date(nowMs - staleAfterMs);

  const db = getDb();
  const rows = await db
    .select({
      id: schema.videoJobs.id,
      status: schema.videoJobs.status,
      updatedAt: schema.videoJobs.updatedAt,
    })
    .from(schema.videoJobs)
    .where(
      and(
        inArray(schema.videoJobs.status, [...STALE_IN_FLIGHT_VIDEO_STATUSES]),
        lt(schema.videoJobs.updatedAt, cutoff),
      ),
    )
    .limit(limit);

  const failedJobIds: string[] = [];
  for (const row of rows) {
    if (!isVideoInFlightStale(row.updatedAt, nowMs, staleAfterMs)) {
      continue;
    }
    const ok = await markVideoJobFailed(row.id, STALE_IN_FLIGHT_FAILURE_MESSAGE);
    if (ok) {
      failedJobIds.push(row.id);
      console.warn(
        `[video-worker] marked stale in-flight job ${row.id} failed (status was ${row.status}, updatedAt=${row.updatedAt.toISOString()})`,
      );
    }
  }

  return { failedJobIds };
}
