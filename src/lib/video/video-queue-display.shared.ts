import { getScoreTarget } from "@/lib/video/score-targets";
import { isInFlightProcessingStatus } from "@/lib/video/video-lifecycle.shared";

/** i18n key under `videoQueue.targets` for a compact queue target label. */
export function videoQueueTargetLabelKey(
  scoreTarget: string | null | undefined,
): string | null {
  if (!scoreTarget) return null;
  return getScoreTarget(scoreTarget)?.labelKey ?? null;
}

/** Compact frame-count progress for the status cell — never a long message. */
export function videoQueueFrameProgress(job: {
  status: string;
  uploadedFrameCount?: number | null;
  frameCount?: number | null;
}): string | null {
  if (job.status === "pending_upload" || isInFlightProcessingStatus(job.status)) {
    if (job.uploadedFrameCount != null && job.frameCount != null) {
      return `${job.uploadedFrameCount}/${job.frameCount}`;
    }
  }
  return null;
}

/** Filename when present, otherwise the job id — for telling similar rows apart. */
export function videoQueueFileIdentity(job: {
  id: string;
  fileName?: string | null;
}): string {
  const name = job.fileName?.trim();
  return name ? name : job.id;
}
