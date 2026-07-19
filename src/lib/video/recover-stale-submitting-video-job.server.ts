import "server-only";

import { and, eq, lt } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { isVideoInFlightStale } from "@/lib/video/fail-stale-in-flight-video-jobs.server";

/**
 * Submit claims review/complete → submitting. If the serverless function is
 * killed mid-Ashed write (timeout / "Failed to fetch"), catch never runs and
 * the job stays submitting forever — discard and re-submit both refuse it.
 *
 * Default Vercel function limit is far below OCR's 300s; 2 minutes is enough
 * to assume a submit claim is abandoned.
 */
export const VIDEO_SUBMITTING_STALE_MS = 2 * 60 * 1000;

/**
 * Reset a single job from stale `submitting` → `review` so officers can
 * discard or retry submit. No-op when fresh or not submitting.
 */
export async function recoverStaleSubmittingVideoJob(
  jobId: string,
  options?: { nowMs?: number; staleAfterMs?: number },
): Promise<{ recovered: boolean; status: string | null }> {
  const nowMs = options?.nowMs ?? Date.now();
  const staleAfterMs = options?.staleAfterMs ?? VIDEO_SUBMITTING_STALE_MS;
  const db = getDb();

  const [job] = await db
    .select({
      id: schema.videoJobs.id,
      status: schema.videoJobs.status,
      updatedAt: schema.videoJobs.updatedAt,
    })
    .from(schema.videoJobs)
    .where(eq(schema.videoJobs.id, jobId))
    .limit(1);

  if (!job) {
    return { recovered: false, status: null };
  }
  if (job.status !== "submitting") {
    return { recovered: false, status: job.status };
  }
  if (!isVideoInFlightStale(job.updatedAt, nowMs, staleAfterMs)) {
    return { recovered: false, status: job.status };
  }

  const cutoff = new Date(nowMs - staleAfterMs);
  const [updated] = await db
    .update(schema.videoJobs)
    .set({ status: "review", updatedAt: new Date(nowMs) })
    .where(
      and(
        eq(schema.videoJobs.id, jobId),
        eq(schema.videoJobs.status, "submitting"),
        lt(schema.videoJobs.updatedAt, cutoff),
      ),
    )
    .returning({ id: schema.videoJobs.id, status: schema.videoJobs.status });

  if (updated) {
    console.warn(
      `[video-submit] recovered stale submitting job ${jobId} → review (updatedAt was ${job.updatedAt.toISOString()})`,
    );
    return { recovered: true, status: "review" };
  }

  const [fresh] = await db
    .select({ status: schema.videoJobs.status })
    .from(schema.videoJobs)
    .where(eq(schema.videoJobs.id, jobId))
    .limit(1);
  return { recovered: false, status: fresh?.status ?? "submitting" };
}
