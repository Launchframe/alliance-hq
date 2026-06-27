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
 * (e.g. OCR just finished), not on repeated snapshots of the same status. The
 * initial page load is handled separately on mount, so a null previous status
 * (first observed event) must not trigger a reload.
 */
export function shouldRefetchOnLiveJobStatus(
  previousStatus: string | null,
  nextStatus: string,
): boolean {
  if (nextStatus !== "review" && nextStatus !== "failed") {
    return false;
  }
  if (previousStatus === null) {
    return false;
  }
  return previousStatus !== nextStatus;
}
