/** Statuses that may be claimed for Ashed/HQ score submit. */
export const VIDEO_SUBMIT_READY_STATUSES = ["review", "complete"] as const;

export type VideoSubmitReadyStatus =
  (typeof VIDEO_SUBMIT_READY_STATUSES)[number];

export const VIDEO_SUBMIT_IN_PROGRESS_ERROR = "Submit already in progress.";

export function isVideoJobReadyForSubmit(status: string): boolean {
  return status === "review" || status === "complete";
}

export function videoSubmitNotReadyError(jobStatus: string): string {
  return `Can't submit — this job's status is "${jobStatus}". Refresh the page. Only jobs in review can be submitted.`;
}

export function videoSubmitClaimLostError(jobStatus: string): string {
  return `Couldn't start submit — this job's status is now "${jobStatus}". Refresh the page and try again.`;
}
