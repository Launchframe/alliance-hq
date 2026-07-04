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
