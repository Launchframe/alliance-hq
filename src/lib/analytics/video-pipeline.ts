/**
 * Vercel Web Analytics custom events for video pipeline timing.
 * Pro plan: up to 2 custom keys per event — we emit one event per phase.
 * Locally: always logs; Vercel track() only when enabled in production.
 */

export type VideoPipelineAnalyticsContext = {
  jobId: string;
  scoreTarget: string;
  source: "api" | "worker";
};

export type VideoProcessTimings = {
  jobId: string;
  scoreTarget: string;
  fileSizeBytes: number | null;
  frameCount: number;
  rowCount: number;
  matchedCount: number;
  totalMs: number;
  phases: Record<string, number>;
  ocrFrameMs: number[];
  ocrFrameAvgMs: number | null;
};

function analyticsEnabled(): boolean {
  return (
    process.env.NODE_ENV === "production" &&
    process.env.VERCEL === "1" &&
    process.env.VIDEO_PIPELINE_ANALYTICS !== "0"
  );
}

async function trackEvent(
  name: string,
  data: Record<string, string | number | boolean | null>,
) {
  if (!analyticsEnabled()) {
    return;
  }
  try {
    const { track } = await import("@vercel/analytics/server");
    await track(name, data);
  } catch (error) {
    console.warn(
      "[video-pipeline analytics]",
      name,
      error instanceof Error ? error.message : error,
    );
  }
}

/** Emit phase timings — one Vercel event per phase (2 keys: phase + ms). */
export async function trackVideoPipelineTimings(
  timings: VideoProcessTimings,
  ctx: VideoPipelineAnalyticsContext,
) {
  const base = {
    jobId: timings.jobId,
    target: timings.scoreTarget,
    source: ctx.source,
  };

  if (!analyticsEnabled()) {
    console.log(
      "[video-pipeline analytics]",
      JSON.stringify({ event: "Video Pipeline Complete", ...timings, ...base }),
    );
  }

  for (const [phase, ms] of Object.entries(timings.phases)) {
    await trackEvent("Video Pipeline Phase", {
      phase,
      ms: Math.round(ms),
    });
  }

  if (timings.ocrFrameAvgMs != null) {
    await trackEvent("Video Pipeline OCR", {
      frames: timings.frameCount,
      avgMs: Math.round(timings.ocrFrameAvgMs),
    });
  }

  await trackEvent("Video Pipeline Complete", {
    totalMs: Math.round(timings.totalMs),
    frames: timings.frameCount,
  });

  await trackEvent("Video Pipeline Rows", {
    rows: timings.rowCount,
    matched: timings.matchedCount,
  });
}

export async function trackVideoPipelineFailure(
  jobId: string,
  scoreTarget: string,
  errorMessage: string,
  totalMs: number,
) {
  await trackEvent("Video Pipeline Failed", {
    totalMs: Math.round(totalMs),
    error: errorMessage.slice(0, 120),
  });

  if (!analyticsEnabled()) {
    console.log(
      "[video-pipeline analytics]",
      JSON.stringify({ event: "Video Pipeline Failed", jobId, scoreTarget, totalMs }),
    );
  }
}
