import { asc, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { authorizeCron } from "@/lib/ops/cron-auth";
import { runCron } from "@/lib/ops/run-cron";
import { failStaleInFlightVideoJobs } from "@/lib/video/fail-stale-in-flight-video-jobs.server";
import { dispatchVideoJobRemote } from "@/lib/video/video-process-dispatch.server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/**
 * Awaits the worker `[jobId]` response (same host or VIDEO_WORKER_BASE_URL).
 * Keep aligned with the worker route's maxDuration — do not import process-job here.
 */
export const maxDuration = 300;

/**
 * Drain one queued job — Vercel Cron backup when upload-side triggers are dropped.
 *
 * Always HTTP-POSTs to `/api/internal/video-process/[jobId]` (app origin or
 * VIDEO_WORKER_BASE_URL). Never import the OCR pipeline here so this lambda
 * stays slim under NFT / Vercel size limits.
 */
export async function GET(request: Request) {
  if (!authorizeCron(request, { alternateEnvKeys: ["VIDEO_WORKER_SECRET"] })) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return runCron("video-process-queue", async () => {
    const stale = await failStaleInFlightVideoJobs();

    const db = getDb();
    const [job] = await db
      .select({
        id: schema.videoJobs.id,
        fileName: schema.videoJobs.fileName,
        scoreTarget: schema.videoJobs.scoreTarget,
        createdAt: schema.videoJobs.createdAt,
      })
      .from(schema.videoJobs)
      .where(eq(schema.videoJobs.status, "queued"))
      .orderBy(asc(schema.videoJobs.createdAt))
      .limit(1);

    if (!job) {
      return {
        processed: 0,
        reason: "idle",
        staleFailed: stale.failedJobIds.length,
        staleFailedJobIds: stale.failedJobIds,
      };
    }

    console.log(
      `[video-worker] pulled job ${job.id} from queue (file=${job.fileName ?? "unknown"}, target=${job.scoreTarget ?? "unknown"}, queuedAt=${job.createdAt.toISOString()})`,
    );

    const result = await dispatchVideoJobRemote(job.id, { source: "cron" });
    return {
      processed: result.processed ? 1 : 0,
      jobId: result.jobId,
      status: result.status,
      ...(result.timings ? { timings: result.timings } : {}),
      ...(result.code ? { code: result.code } : {}),
      ...(result.error ? { error: result.error } : {}),
      staleFailed: stale.failedJobIds.length,
      staleFailedJobIds: stale.failedJobIds,
      httpStatus: result.httpStatus,
    };
  });
}
