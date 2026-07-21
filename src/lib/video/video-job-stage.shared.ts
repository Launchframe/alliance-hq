/**
 * Fine-grained processing stages for the video job pipeline, layered on top
 * of the coarse `video_jobs.status` column (queued / extracting / parsing /
 * review / failed). Stage is display-only — it drives the waiting-page
 * progress bar and event banner only. It is never persisted as a distinct
 * DB status value and never gates business logic.
 */

export const VIDEO_JOB_STAGES = [
  "queued",
  "awaiting_approval",
  "extracting_frames",
  "ocr_running",
  "finalizing_rows",
  "done",
  "failed",
] as const;

export type VideoJobStage = (typeof VIDEO_JOB_STAGES)[number];

export function isVideoJobStage(value: string): value is VideoJobStage {
  return (VIDEO_JOB_STAGES as readonly string[]).includes(value);
}

/** Fallback stage for events that predate the `stage` field, or omit it. */
export function defaultStageForJobStatus(status: string): VideoJobStage | null {
  switch (status) {
    case "queued":
      return "queued";
    case "pending_approval":
      return "awaiting_approval";
    case "extracting":
      return "extracting_frames";
    case "parsing":
      return "ocr_running";
    case "review":
    case "complete":
      return "done";
    case "failed":
      return "failed";
    default:
      return null;
  }
}

/** Prefer an explicit stage from the event; fall back to the status default. */
export function resolveVideoJobStage(
  status: string,
  explicitStage?: string | null,
): VideoJobStage | null {
  if (explicitStage && isVideoJobStage(explicitStage)) {
    return explicitStage;
  }
  return defaultStageForJobStatus(status);
}

export type VideoJobFrameProgress = {
  completed: number;
  total: number;
};

type StageBand = { start: number; end: number };

/**
 * Progress bands leave headroom between stages so the bar visibly advances
 * on every stage change, even for stages with no internal frame counter.
 * `ocr_running` is the only stage interpolated with real frame progress —
 * it is usually the longest phase, and is the one stage with true per-frame
 * granularity threaded through the OCR pipelines.
 */
const STAGE_BAND: Record<VideoJobStage, StageBand> = {
  queued: { start: 0, end: 2 },
  awaiting_approval: { start: 0, end: 2 },
  extracting_frames: { start: 2, end: 15 },
  ocr_running: { start: 15, end: 85 },
  finalizing_rows: { start: 85, end: 97 },
  done: { start: 100, end: 100 },
  failed: { start: 0, end: 0 },
};

export function videoJobStageProgressPercent(
  stage: VideoJobStage | null,
  frameProgress?: VideoJobFrameProgress | null,
): number {
  if (!stage) return 0;
  const band = STAGE_BAND[stage];
  if (stage === "ocr_running" && frameProgress && frameProgress.total > 0) {
    const fraction = Math.min(
      1,
      Math.max(0, frameProgress.completed / frameProgress.total),
    );
    return Math.round(band.start + fraction * (band.end - band.start));
  }
  return band.start === band.end
    ? band.start
    : Math.round((band.start + band.end) / 2);
}

/**
 * Stages with no internal frame counter render as a subtle pulse instead of
 * a fixed-width fill, so the bar doesn't look stalled while still being
 * honest about not having fine-grained progress for that stage.
 */
export function isIndeterminateVideoJobStage(
  stage: VideoJobStage | null,
  frameProgress?: VideoJobFrameProgress | null,
): boolean {
  if (stage === "ocr_running") {
    return !frameProgress || frameProgress.total <= 0;
  }
  return (
    stage === "queued" ||
    stage === "awaiting_approval" ||
    stage === "extracting_frames" ||
    stage === "finalizing_rows"
  );
}

export type VideoJobEngineLabelKey =
  | "engineAshed"
  | "engineNative"
  | "engineMock";

/**
 * Message key (under the `videoReview` i18n namespace) for a resolved OCR
 * engine id, naming the pipeline actually doing the work — "Ashed" or
 * "In-house Tesseract" today. `native` is Tesseract-backed OCR; once an
 * in-house OpenCV pipeline ships, add its own engine id + `engineOpencv`
 * key here rather than overloading `native`.
 */
export function videoJobEngineLabelKey(
  engine?: string | null,
): VideoJobEngineLabelKey | null {
  switch (engine) {
    case "ashed":
      return "engineAshed";
    case "native":
      return "engineNative";
    case "mock":
      return "engineMock";
    default:
      return null;
  }
}

/** Whether the pipeline banner should be shown at all for this stage. */
export function stageShowsPipelineLabel(stage: VideoJobStage | null): boolean {
  return (
    stage === "extracting_frames" ||
    stage === "ocr_running" ||
    stage === "finalizing_rows"
  );
}
