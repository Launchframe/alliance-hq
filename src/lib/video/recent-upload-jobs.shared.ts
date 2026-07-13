import { isActiveVideoJobStatus } from "@/lib/events/video-jobs-types";

type RecentUploadJobFields = {
  status: string;
  approvedAt?: string | null;
};

type RejectedAtInput = RecentUploadJobFields & {
  updatedAt: string;
};

/**
 * Recent uploads hide self-discards after OCR (discarded with approval) but keep
 * processor rejects (discarded before approval) so uploaders see "Rejected at".
 */
export function shouldShowRecentUploadJob(job: RecentUploadJobFields): boolean {
  return job.status !== "discarded" || job.approvedAt == null;
}

/** Processor rejects lack approvedAt; use updatedAt until a dedicated column exists. */
export function deriveRejectedAt(job: RejectedAtInput): string | null {
  return job.status === "discarded" && job.approvedAt == null
    ? job.updatedAt
    : null;
}

/**
 * SSE events omit approvedAt; infer it when a pending job transitions into
 * processing after processor approval (updatedAt is set at approve time).
 */
export function deriveApprovedAtFromLiveUpdate(input: {
  previousStatus: string;
  nextStatus: string;
  existingApprovedAt?: string | null;
  liveUpdatedAt: string;
}): string | null | undefined {
  if (input.existingApprovedAt) {
    return input.existingApprovedAt;
  }
  if (input.previousStatus !== "pending_approval") {
    return undefined;
  }
  if (
    input.nextStatus === "queued" ||
    isActiveVideoJobStatus(input.nextStatus) ||
    input.nextStatus === "review" ||
    input.nextStatus === "complete"
  ) {
    return input.liveUpdatedAt;
  }
  return undefined;
}
