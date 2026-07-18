const TERMINAL_LIVE_STATUSES = new Set(["review", "failed"]);

/** REST statuses that mean the page is still waiting on OCR / pipeline work. */
const ACTIVE_REST_STATUSES = new Set([
  "pending_approval",
  "queued",
  "extracting",
  "parsing",
  "loading",
]);

/**
 * Decide whether the review page should refetch job data in response to a live
 * (SSE) job-status update.
 *
 * The video-jobs SSE stream re-emits a `snapshot` event on every (re)connect,
 * and the provider's merge produces a new object reference each time even when
 * the status is unchanged. A naive "reload whenever status is review/failed"
 * effect therefore fires on every snapshot and clobbers the reviewer's
 * in-progress edits.
 *
 * We only want to refetch when the job *transitions* into a review/failed state
 * (e.g. OCR just finished), not on repeated snapshots of the same status.
 *
 * Exception: the first observed SSE event may already be terminal while the
 * page's REST `jobStatus` is still active (opened mid-flight; job finished
 * before any prior live status was recorded). Mount load alone cannot see that
 * transition, so we refetch in that case. When REST is already terminal,
 * mount load owns the initial payload and a null previous must not reload.
 */
export function shouldRefetchOnLiveJobStatus(
  previousStatus: string | null,
  nextStatus: string,
  options?: { restStatus?: string | null },
): boolean {
  if (!TERMINAL_LIVE_STATUSES.has(nextStatus)) {
    return false;
  }
  if (previousStatus === null) {
    const restStatus = options?.restStatus;
    return restStatus != null && ACTIVE_REST_STATUSES.has(restStatus);
  }
  return previousStatus !== nextStatus;
}
