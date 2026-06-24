import { waitUntil } from "@vercel/functions";

import { resolveAppOrigin } from "@/lib/app-origin";
import { logPipelineStep } from "@/lib/video/pipeline-step-log";

export function resolveVideoArchiveBaseUrl(): string {
  if (process.env.VIDEO_WORKER_BASE_URL) {
    return process.env.VIDEO_WORKER_BASE_URL.replace(/\/$/, "");
  }
  return resolveAppOrigin();
}

export async function dispatchVideoArchive(jobId: string): Promise<void> {
  const secret = process.env.VIDEO_WORKER_SECRET;
  if (!secret) {
    console.error(
      `[video-archive] ${jobId} skipped: VIDEO_WORKER_SECRET is not configured`,
    );
    return;
  }

  const base = resolveVideoArchiveBaseUrl();
  const url = `${base}/api/internal/video-archive/${jobId}`;

  const task = (async () => {
    const started = Date.now();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "x-video-worker": "1",
        },
      });
      const body = await res.text();
      if (!res.ok) {
        console.error(
          `[video-archive] ${jobId} failed (${res.status}):`,
          body.slice(0, 300),
        );
        logPipelineStep("trigger.archive_failed", Date.now() - started, {
          jobId,
          status: res.status,
        });
        return;
      }
      logPipelineStep("trigger.archive_dispatched", Date.now() - started, {
        jobId,
        status: res.status,
      });
    } catch (error) {
      console.error(
        `[video-archive] ${jobId} error:`,
        error instanceof Error ? error.message : error,
      );
      logPipelineStep("trigger.archive_error", Date.now() - started, {
        jobId,
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
