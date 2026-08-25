import { buildVideoUploadHref } from "@/lib/video/score-target-nav";
import { vsScoreReferenceDate } from "@/lib/trains/vs-week-days.shared";
import type { TrainsVsDataStatus } from "@/lib/trains/vs-data-status.shared";

/** VS Performance upload deep-link for Trains guided flow (prior-day scores). */
export function buildTrainsGuidedVideoUploadHref(input: {
  trainDate: string;
  vsDataStatus?: TrainsVsDataStatus | null;
  leadDays?: number;
}): string {
  const scoreDate =
    input.vsDataStatus?.scoreDate ??
    vsScoreReferenceDate(input.trainDate, input.leadDays ?? 0);
  return buildVideoUploadHref("vs-performance", { recordedDate: scoreDate });
}
