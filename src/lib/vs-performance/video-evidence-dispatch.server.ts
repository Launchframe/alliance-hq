import "server-only";

import { waitUntil } from "@vercel/functions";

import { resolveAppOrigin } from "@/lib/app-origin";

export async function dispatchVsVideoEvidence(
  jobId: string,
): Promise<boolean> {
  const secret = process.env.VIDEO_WORKER_SECRET;
  if (!secret) {
    console.error(
      `[vs-video-evidence] ${jobId} skipped: VIDEO_WORKER_SECRET is not configured`,
    );
    return false;
  }

  const url = `${resolveAppOrigin()}/api/internal/vs-video-evidence/${encodeURIComponent(jobId)}`;
  const task = (async (): Promise<boolean> => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const code = `http_${res.status}`;
        console.error(`[vs-video-evidence] ${jobId} dispatch failed (${code})`);
        return false;
      }
      return true;
    } catch {
      console.error(`[vs-video-evidence] ${jobId} dispatch error`);
      return false;
    }
  })();

  if (process.env.VERCEL) {
    waitUntil(task);
    return true;
  }
  void task;
  return true;
}
