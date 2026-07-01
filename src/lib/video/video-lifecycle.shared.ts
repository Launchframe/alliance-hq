/** Statuses shown on the alliance active queue (/tools/video-upload/queue). */
export const ACTIVE_QUEUE_VIDEO_JOB_STATUSES = [
  "pending_approval",
  "queued",
  "extracting",
  "parsing",
  "review",
  "submitting",
  "failed",
] as const;

export type ActiveQueueVideoJobStatus =
  (typeof ACTIVE_QUEUE_VIDEO_JOB_STATUSES)[number];

/** Terminal statuses hidden from the active queue (alliance history later). */
export const HIDDEN_QUEUE_VIDEO_JOB_STATUSES = [
  "complete",
  "submitted",
  "discarded",
] as const;

export function isActiveQueueVideoJobStatus(
  status: string,
): status is ActiveQueueVideoJobStatus {
  return (ACTIVE_QUEUE_VIDEO_JOB_STATUSES as readonly string[]).includes(status);
}

export function isHiddenFromActiveQueue(status: string): boolean {
  return (HIDDEN_QUEUE_VIDEO_JOB_STATUSES as readonly string[]).includes(status);
}

export type VideoJobLifecycleStage =
  | "needs_approval"
  | "processing"
  | "ready_to_review"
  | "submitting"
  | "needs_attention";

export function videoJobLifecycleStage(
  status: string,
): VideoJobLifecycleStage | null {
  if (status === "pending_approval") return "needs_approval";
  if (status === "queued" || status === "extracting" || status === "parsing") {
    return "processing";
  }
  if (status === "review") return "ready_to_review";
  if (status === "submitting") return "submitting";
  if (status === "failed") return "needs_attention";
  return null;
}

export function isInFlightProcessingStatus(status: string): boolean {
  return (
    status === "queued" || status === "extracting" || status === "parsing"
  );
}
