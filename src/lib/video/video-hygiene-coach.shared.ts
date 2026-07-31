/**
 * Coach tip selection for the video hygiene learning loop.
 * Tip IDs map to i18n keys under videoHygieneCoach.tips.*.
 */

import { isMemberRosterVideoTarget } from "@/lib/video/score-targets";

export const VIDEO_HYGIENE_COACH_TIP_IDS = [
  "chaoticScroll",
  "fastScroll",
  "lowQuality",
  "longReview",
  "thumbsDown",
  "scenePageByPage",
  "defaultSteady",
] as const;

export type VideoHygieneCoachTipId =
  (typeof VIDEO_HYGIENE_COACH_TIP_IDS)[number];

export type CoachTipInput = {
  scoreTarget: string;
  jobCount: number;
  thumbsUpRate: number | null;
  avgQualityScore: number | null;
  medianReviewDurationMs: number | null;
  scrollStyleCounts: Record<string, number>;
};

/** Scene-threshold capture (not roster supplementFps path). */
export function prefersSceneFrameCapture(scoreTarget: string): boolean {
  return !isMemberRosterVideoTarget(scoreTarget);
}

const MIN_JOBS_FOR_COACH = 2;
/** Reviews longer than 4 minutes median → longReview tip. */
const LONG_REVIEW_MS = 4 * 60 * 1000;

function dominantScrollStyle(
  counts: Record<string, number>,
): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [style, count] of Object.entries(counts)) {
    if (count > bestCount) {
      best = style;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Pick a single tip for this user×scoreTarget, or null when history is too thin
 * / already healthy with no actionable signal.
 */
export function selectVideoHygieneCoachTip(
  input: CoachTipInput,
): VideoHygieneCoachTipId | null {
  if (input.jobCount < MIN_JOBS_FOR_COACH) {
    return null;
  }

  const scroll = dominantScrollStyle(input.scrollStyleCounts);
  if (scroll === "chaotic") return "chaoticScroll";
  if (scroll === "fast") return "fastScroll";

  if (
    input.thumbsUpRate != null &&
    input.thumbsUpRate < 0.5 &&
    input.jobCount >= 3
  ) {
    return "thumbsDown";
  }

  if (input.avgQualityScore != null && input.avgQualityScore < 0.5) {
    return "lowQuality";
  }

  if (
    input.medianReviewDurationMs != null &&
    input.medianReviewDurationMs >= LONG_REVIEW_MS
  ) {
    return "longReview";
  }

  if (
    prefersSceneFrameCapture(input.scoreTarget) &&
    scroll === "slow_steady"
  ) {
    return "scenePageByPage";
  }

  if (scroll === "slow_steady" || scroll === "page_by_page") {
    return "defaultSteady";
  }

  // Thin survey signal but enough jobs — reinforce steady capture.
  return "defaultSteady";
}
