/** Statuses that may be claimed for Ashed/HQ score submit. */
export const VIDEO_SUBMIT_READY_STATUSES = ["review", "complete"] as const;

export type VideoSubmitReadyStatus =
  (typeof VIDEO_SUBMIT_READY_STATUSES)[number];

export const VIDEO_SUBMIT_IN_PROGRESS_ERROR = "Submit already in progress.";

export function isVideoJobReadyForSubmit(status: string): boolean {
  return (VIDEO_SUBMIT_READY_STATUSES as readonly string[]).includes(status);
}

export function videoSubmitNotReadyError(jobStatus: string): string {
  return `Can't submit — this job's status is "${jobStatus}". Refresh the page. Only jobs in review can be submitted.`;
}

export function videoSubmitClaimLostError(jobStatus: string): string {
  return `Couldn't start submit — this job's status is now "${jobStatus}". Refresh the page and try again.`;
}

/**
 * After claim("submitting"), choose the status to restore on failure.
 *
 * When prior Ashed rows were already cleared (delete-by-date succeeded) but
 * insert/bookkeeping failed, force `review` so Update-scores does not look
 * complete while Ashed may be empty for that day/event.
 */
export function resolveVideoSubmitRollbackStatus(input: {
  originalStatus: string;
  clearedPriorAshedScores: boolean;
}): "review" | "complete" {
  if (input.clearedPriorAshedScores) {
    return "review";
  }
  return input.originalStatus === "complete" ? "complete" : "review";
}
