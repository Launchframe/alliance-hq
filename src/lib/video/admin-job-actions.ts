/** Statuses where another worker owns the job — reprocess would race and wipe state. */
export const VIDEO_JOB_REPROCESS_BLOCKED_STATUSES = [
  "extracting",
  "parsing",
  "submitting",
] as const;

const VIDEO_JOB_REPROCESS_BLOCKED_STATUS_SET = new Set<string>(
  VIDEO_JOB_REPROCESS_BLOCKED_STATUSES,
);

export function isVideoJobReprocessBlockedStatus(status: string): boolean {
  return VIDEO_JOB_REPROCESS_BLOCKED_STATUS_SET.has(status);
}

/** Re-dispatch worker for jobs stuck in queue or failed without resetting parse state. */
export function canRequeueVideoJob(status: string): boolean {
  return status === "queued" || status === "failed";
}

/**
 * Full reset + inline process — block while extraction/parse or Ashed submit
 * is in flight (reprocess would delete parse rows mid-submit).
 */
export function canReprocessVideoJob(status: string): boolean {
  return !isVideoJobReprocessBlockedStatus(status);
}

export function videoJobReprocessInFlightMessage(status: string): string {
  return `Cannot reprocess job in status "${status}" while processing is in flight.`;
}

/** Prefer SSE live status; REST job status lags after reprocess on the review page. */
export function resolveReprocessGateStatus(
  restStatus: string,
  liveStatus: string | null | undefined,
): string {
  return liveStatus ?? restStatus;
}
