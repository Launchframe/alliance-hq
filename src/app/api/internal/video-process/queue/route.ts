import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { processVideoJob } from "@/lib/video/process-job";

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
    .select({ id: schema.videoJobs.id })
    .from(schema.videoJobs)
    .where(eq(schema.videoJobs.status, "queued"))
    .orderBy(asc(schema.videoJobs.createdAt))
    .limit(1);

  if (!job) {
    return NextResponse.json({ ok: true, processed: false, reason: "idle" });
  }

  try {
    const timings = await processVideoJob(job.id, { analyticsSource: "worker" });
    return NextResponse.json({
      ok: true,
      processed: true,
      jobId: job.id,
      status: "review",
      timings,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        processed: true,
        jobId: job.id,
        error: error instanceof Error ? error.message : "Processing failed",
      },
      { status: 500 },
    );
  }
}
