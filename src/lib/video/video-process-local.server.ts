import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { markVideoJobFailed } from "@/lib/video/mark-video-job-failed";
import { isAshedNotConnectedError } from "@/lib/video/errors";
import type { VideoProcessJobResult } from "@/lib/video/video-process-dispatch.server";

export async function runVideoProcessJobLocally(
  jobId: string,
  options?: { analyticsSource?: "worker" | "api" },
): Promise<VideoProcessJobResult> {
  try {
    const { processVideoJob } = await import("@/lib/video/process-job");
    const timings = await processVideoJob(jobId, {
      analyticsSource: options?.analyticsSource ?? "worker",
    });
    const db = getDb();
    const [job] = await db
      .select({ status: schema.videoJobs.status })
      .from(schema.videoJobs)
      .where(eq(schema.videoJobs.id, jobId))
      .limit(1);
    // Chunked deposit-slip OCR leaves the job `queued` for the next slice.
    const status = job?.status ?? "review";
    return {
      ok: true,
      processed: true,
      jobId,
      status,
      timings,
      httpStatus: 200,
    };
  } catch (error) {
    if (isAshedNotConnectedError(error)) {
      return {
        ok: false,
        processed: false,
        jobId,
        status: "pending_approval",
        code: "ashed_not_connected",
        httpStatus: 200,
      };
    }
    const message =
      error instanceof Error ? error.message : "Processing failed";
    await markVideoJobFailed(jobId, message);
    return {
      ok: false,
      processed: true,
      jobId,
      status: "failed",
      error: message,
      httpStatus: 500,
    };
  }
}
