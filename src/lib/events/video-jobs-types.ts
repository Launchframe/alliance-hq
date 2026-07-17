import { defaultStageForJobStatus } from "@/lib/video/video-job-stage.shared";

export type VideoJobStatusEvent = {
  sessionId: string;
  /** HQ user who uploaded — present so other devices for the same user receive events. */
  enqueuedByHqUserId?: string | null;
  hqUserId?: string | null;
  jobId: string;
  status: string;
  fileName: string | null;
  scoreTarget: string | null;
  frameCount?: number | null;
  uploadedFrameCount?: number | null;
  rowCount?: number | null;
  matchedCount?: number | null;
  errorMessage?: string | null;
  /**
   * Fine-grained pipeline stage layered on top of `status` — display-only,
   * for the waiting-page progress bar/banner. Older events (or emit sites
   * that haven't been updated) omit this; clients fall back to
   * `defaultStageForJobStatus(status)` from video-job-stage.shared.ts.
   */
  stage?: string | null;
  /** OCR engine used for this job's pass, once resolved. See ocr-provider.shared.ts. */
  ocrEngine?: string | null;
  updatedAt: string;
};

export function isActiveVideoJobStatus(status: string): boolean {
  return (
    status === "queued" ||
    status === "extracting" ||
    status === "parsing" ||
    status === "submitting"
  );
}

/** Uploaded and waiting for a video processor to approve and run OCR. */
export function isPendingApprovalStatus(status: string): boolean {
  return status === "pending_approval";
}

export function isTerminalVideoJobStatus(status: string): boolean {
  return status === "review" || status === "failed" || status === "complete";
}

export function isReviewReadyStatus(status: string): boolean {
  return status === "review";
}

export function parseVideoJobStatusEvent(
  payload: string,
): VideoJobStatusEvent | null {
  try {
    const parsed = JSON.parse(payload) as VideoJobStatusEvent;
    if (!parsed.sessionId || !parsed.jobId || !parsed.status) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Merge a newer live event onto the cached job. Nullish progress/stage fields
 * must not wipe values from an earlier, richer event (e.g. OCR progress that
 * omits `frameCount` after the parsing kickoff already set the total).
 */
export function mergeVideoJobStatusEvent(
  current: VideoJobStatusEvent | undefined,
  next: VideoJobStatusEvent,
): VideoJobStatusEvent {
  if (!current) {
    return next;
  }
  if (
    new Date(next.updatedAt).getTime() < new Date(current.updatedAt).getTime()
  ) {
    return current;
  }

  const stage =
    next.stage ??
    (next.status !== current.status
      ? defaultStageForJobStatus(next.status)
      : undefined) ??
    current.stage;

  return {
    ...current,
    ...next,
    frameCount: next.frameCount ?? current.frameCount,
    uploadedFrameCount:
      next.uploadedFrameCount ?? current.uploadedFrameCount,
    stage,
    ocrEngine: next.ocrEngine ?? current.ocrEngine,
  };
}
