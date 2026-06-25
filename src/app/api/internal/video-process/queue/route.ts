import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { markVideoJobFailed } from "@/lib/video/mark-video-job-failed";
import { isAshedNotConnectedError } from "@/lib/video/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function authorize(request: Request): boolean {
  const auth = request.headers.get("authorization");
  const workerSecret = process.env.VIDEO_WORKER_SECRET;
  if (workerSecret && auth === `Bearer ${workerSecret}`) {
    return true;
  }
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && auth === `Bearer ${cronSecret}`) {
    return true;
  }
  return false;
}

/** Drain one queued job — Vercel Cron backup when upload-side triggers are dropped. */
export async function GET(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
    return NextResponse.json({ ok: true, processed: false, reason: "idle" });
  }

  console.log(
    `[video-worker] pulled job ${job.id} from queue (file=${job.fileName ?? "unknown"}, target=${job.scoreTarget ?? "unknown"}, queuedAt=${job.createdAt.toISOString()})`,
  );

  try {
    const { processVideoJob } = await import("@/lib/video/process-job");
    const timings = await processVideoJob(job.id, { analyticsSource: "worker" });
    return NextResponse.json({
      ok: true,
      processed: true,
      jobId: job.id,
      status: "review",
      timings,
    });
  } catch (error) {
    // Recoverable: process-job already reverted the job to pending_approval.
    if (isAshedNotConnectedError(error)) {
      return NextResponse.json({
        ok: false,
        processed: false,
        jobId: job.id,
        status: "pending_approval",
        code: "ashed_not_connected",
      });
    }
    const message =
      error instanceof Error ? error.message : "Processing failed";
    await markVideoJobFailed(job.id, message);
    return NextResponse.json(
      {
        ok: false,
        processed: true,
        jobId: job.id,
        status: "failed",
        error: message,
      },
      { status: 500 },
    );
  }
}
