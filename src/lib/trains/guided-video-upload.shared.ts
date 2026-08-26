import { buildVideoUploadHref } from "@/lib/video/score-target-nav";
import { vsScoreReferenceDate } from "@/lib/trains/vs-week-days.shared";
import type { TrainsVsDataStatus } from "@/lib/trains/vs-data-status.shared";

const TRAIN_DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/;

/** Resume trains hub after VS score upload, with the same day selected. */
export function buildTrainsScoresReadyReturnPath(trainDate: string): string {
  const params = new URLSearchParams({
    date: trainDate,
    scoresReady: "1",
  });
  return `/trains?${params.toString()}`;
}

export function parseTrainsHubDateParam(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed || !TRAIN_DATE_PARAM.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function parseTrainsScoresReadyParam(
  value: string | null | undefined,
): boolean {
  return value?.trim() === "1";
}

/** VS Performance upload deep-link for Trains guided flow (prior-day / lead-time scores). */
export function buildTrainsGuidedVideoUploadHref(input: {
  trainDate: string;
  vsDataStatus?: TrainsVsDataStatus | null;
  /** Explicit score recorded date (preferred over vsDataStatus / lead-time math). */
  scoreDate?: string | null;
  leadDays?: number;
  /**
   * When true, append returnTo so submit resumes the trains hub for `trainDate`.
   * When a string, use that path as returnTo (must be a safe internal path).
   */
  returnTo?: boolean | string;
}): string {
  const scoreDate =
    input.scoreDate ??
    input.vsDataStatus?.scoreDate ??
    vsScoreReferenceDate(input.trainDate, input.leadDays ?? 0);
  const returnTo =
    input.returnTo === true
      ? buildTrainsScoresReadyReturnPath(input.trainDate)
      : typeof input.returnTo === "string"
        ? input.returnTo
        : null;
  return buildVideoUploadHref("vs-performance", {
    recordedDate: scoreDate,
    returnTo,
  });
}
