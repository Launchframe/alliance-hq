const VIDEO_JOB_IN_FLIGHT_STATUSES = new Set(["extracting", "parsing"]);

/** Re-dispatch worker for jobs stuck in queue or failed without resetting parse state. */
export function canRequeueVideoJob(status: string): boolean {
  return status === "queued" || status === "failed";
}

/** Full reset + inline process — block while another worker pass is active. */
export function canReprocessVideoJob(status: string): boolean {
  return !VIDEO_JOB_IN_FLIGHT_STATUSES.has(status);
}

/** Prefer SSE live status; REST job status lags after reprocess on the review page. */
export function resolveReprocessGateStatus(
  restStatus: string,
  liveStatus: string | null | undefined,
): string {
  return liveStatus ?? restStatus;
}
