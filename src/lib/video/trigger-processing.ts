import { waitUntil } from "@vercel/functions";

import { resolveAppOrigin } from "@/lib/app-origin";
import { logPipelineStep } from "@/lib/video/pipeline-step-log";

export function resolveVideoProcessBaseUrl(): string {
  if (process.env.VIDEO_WORKER_BASE_URL) {
    return process.env.VIDEO_WORKER_BASE_URL.replace(/\/$/, "");
  }
  return resolveAppOrigin();
}

export async function dispatchVideoProcessing(
  jobId: string,
  options?: { source?: string },
): Promise<void> {
  const secret = process.env.VIDEO_WORKER_SECRET;
  if (!secret) {
    console.error(
      `[video-trigger] ${jobId} skipped: VIDEO_WORKER_SECRET is not configured`,
    );
    return;
  }

  const base = resolveVideoProcessBaseUrl();
  const url = `${base}/api/internal/video-process/${jobId}`;
  const source = options?.source ?? "upload";

  const task = (async () => {
    const started = Date.now();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "x-video-worker": source === "upload" ? "0" : "1",
        },
      });
      const body = await res.text();
      if (!res.ok) {
        console.error(
          `[video-trigger] ${jobId} failed (${res.status}) from ${source}:`,
          body.slice(0, 300),
        );
        logPipelineStep("trigger.process_failed", Date.now() - started, {
          jobId,
          source,
          status: res.status,
        });
        return;
      }
      logPipelineStep("trigger.process_dispatched", Date.now() - started, {
        jobId,
        source,
        status: res.status,
      });
    } catch (error) {
      console.error(
        `[video-trigger] ${jobId} error from ${source}:`,
        error instanceof Error ? error.message : error,
      );
      logPipelineStep("trigger.process_error", Date.now() - started, {
        jobId,
        source,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  })();

  if (process.env.VERCEL) {
    waitUntil(task);
    return;
  }

  void task;
}
