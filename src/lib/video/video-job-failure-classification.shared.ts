/**
 * Officer-facing classification for failed video jobs. Maps stored
 * `errorMessage` strings (often raw exception text) to retry guidance.
 */

/** Stored on failed jobs when the stale in-flight sweep marks a timed-out worker. */
export const STALE_IN_FLIGHT_FAILURE_MESSAGE =
  "Worker timed out or crashed during processing. Requeue to try again.";

export type VideoJobFailureAudience =
  | "retryable"
  | "needs_platform_attention";

export type VideoJobFailureReasonKey =
  | "stale_worker_timeout"
  | "missing_error_message"
  | "unknown";

export type VideoJobFailureClassification = {
  audience: VideoJobFailureAudience;
  reasonKey: VideoJobFailureReasonKey;
};

export type VideoJobFailureReviewMessageKey =
  | "processingFailedRetryable"
  | "processingFailedPlatform";

/** i18n keys under `videoReview`. */
export function videoJobFailureReviewMessageKey(
  classification: VideoJobFailureClassification,
): VideoJobFailureReviewMessageKey {
  return classification.audience === "retryable"
    ? "processingFailedRetryable"
    : "processingFailedPlatform";
}

export function classifyVideoJobFailure(
  errorMessage: string | null | undefined,
): VideoJobFailureClassification {
  const normalized = errorMessage?.trim() ?? "";
  if (!normalized) {
    return {
      audience: "needs_platform_attention",
      reasonKey: "missing_error_message",
    };
  }
  if (normalized === STALE_IN_FLIGHT_FAILURE_MESSAGE) {
    return {
      audience: "retryable",
      reasonKey: "stale_worker_timeout",
    };
  }
  return {
    audience: "needs_platform_attention",
    reasonKey: "unknown",
  };
}
