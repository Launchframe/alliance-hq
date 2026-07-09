import "server-only";

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
    return {
      ok: true,
      processed: true,
      jobId,
      status: "review",
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
