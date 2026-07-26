/**
 * Shared types and pure helpers for the video hygiene learning loop.
 */

export const VIDEO_HYGIENE_EVENT_KINDS = [
  "coach_shown",
  "coach_dismissed",
  "adapt_bias_on",
  "adapt_bias_off",
  "adapt_arm_change",
] as const;

export type VideoHygieneEventKind = (typeof VIDEO_HYGIENE_EVENT_KINDS)[number];

export function isVideoHygieneEventKind(
  value: string,
): value is VideoHygieneEventKind {
  return (VIDEO_HYGIENE_EVENT_KINDS as readonly string[]).includes(value);
}

/** Officer review latency in ms; null when review was never opened. */
export function computeReviewDurationMs(
  reviewOpenedAt: Date | string | null | undefined,
  endedAt: Date | string = new Date(),
): number | null {
  if (reviewOpenedAt == null) return null;
  const opened =
    reviewOpenedAt instanceof Date
      ? reviewOpenedAt.getTime()
      : new Date(reviewOpenedAt).getTime();
  const ended =
    endedAt instanceof Date ? endedAt.getTime() : new Date(endedAt).getTime();
  if (!Number.isFinite(opened) || !Number.isFinite(ended) || ended < opened) {
    return null;
  }
  return Math.round(ended - opened);
}

/** Median of a numeric list; null when empty. */
export function medianNumber(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

export type UploaderScoreTargetRewardRow = {
  hqUserId: string;
  scoreTarget: string;
  jobCount: number;
  ratedCount: number;
  thumbsUpCount: number;
  thumbsDownCount: number;
  thumbsUpRate: number | null;
  avgQualityScore: number | null;
  medianReviewDurationMs: number | null;
  avgRowsEdited: number | null;
  avgRowsDeleted: number | null;
  avgRowsAdded: number | null;
  scrollStyleCounts: Record<string, number>;
};

export function aggregateUploaderScoreTargetRewards(
  jobs: Array<{
    hqUserId: string;
    scoreTarget: string;
    rating: string | null;
    qualityScore: number | null;
    reviewDurationMs: number | null;
    reviewRowsEdited: number | null;
    reviewRowsDeleted: number | null;
    reviewRowsAdded: number | null;
    scrollStyle: string | null;
  }>,
): UploaderScoreTargetRewardRow[] {
  type Acc = {
    hqUserId: string;
    scoreTarget: string;
    jobCount: number;
    ratedCount: number;
    thumbsUpCount: number;
    thumbsDownCount: number;
    qualityScores: number[];
    reviewDurations: number[];
    rowsEdited: number[];
    rowsDeleted: number[];
    rowsAdded: number[];
    scrollStyleCounts: Record<string, number>;
  };

  const byKey = new Map<string, Acc>();

  for (const job of jobs) {
    const key = `${job.hqUserId}\0${job.scoreTarget}`;
    let acc = byKey.get(key);
    if (!acc) {
      acc = {
        hqUserId: job.hqUserId,
        scoreTarget: job.scoreTarget,
        jobCount: 0,
        ratedCount: 0,
        thumbsUpCount: 0,
        thumbsDownCount: 0,
        qualityScores: [],
        reviewDurations: [],
        rowsEdited: [],
        rowsDeleted: [],
        rowsAdded: [],
        scrollStyleCounts: {},
      };
      byKey.set(key, acc);
    }
    acc.jobCount += 1;
    if (job.rating === "thumbs_up" || job.rating === "thumbs_down") {
      acc.ratedCount += 1;
      if (job.rating === "thumbs_up") acc.thumbsUpCount += 1;
      if (job.rating === "thumbs_down") acc.thumbsDownCount += 1;
    }
    if (job.qualityScore != null && Number.isFinite(job.qualityScore)) {
      acc.qualityScores.push(job.qualityScore);
    }
    if (
      job.reviewDurationMs != null &&
      Number.isFinite(job.reviewDurationMs) &&
      job.reviewDurationMs >= 0
    ) {
      acc.reviewDurations.push(job.reviewDurationMs);
    }
    if (job.reviewRowsEdited != null) acc.rowsEdited.push(job.reviewRowsEdited);
    if (job.reviewRowsDeleted != null) {
      acc.rowsDeleted.push(job.reviewRowsDeleted);
    }
    if (job.reviewRowsAdded != null) acc.rowsAdded.push(job.reviewRowsAdded);
    if (job.scrollStyle) {
      acc.scrollStyleCounts[job.scrollStyle] =
        (acc.scrollStyleCounts[job.scrollStyle] ?? 0) + 1;
    }
  }

  const avg = (xs: number[]) =>
    xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

  return [...byKey.values()].map((acc) => ({
    hqUserId: acc.hqUserId,
    scoreTarget: acc.scoreTarget,
    jobCount: acc.jobCount,
    ratedCount: acc.ratedCount,
    thumbsUpCount: acc.thumbsUpCount,
    thumbsDownCount: acc.thumbsDownCount,
    thumbsUpRate:
      acc.ratedCount === 0 ? null : acc.thumbsUpCount / acc.ratedCount,
    avgQualityScore: avg(acc.qualityScores),
    medianReviewDurationMs: medianNumber(acc.reviewDurations),
    avgRowsEdited: avg(acc.rowsEdited),
    avgRowsDeleted: avg(acc.rowsDeleted),
    avgRowsAdded: avg(acc.rowsAdded),
    scrollStyleCounts: acc.scrollStyleCounts,
  }));
}

export type ReviewOutcomeMetrics = {
  reviewOpenedAt: Date | string | null | undefined;
  endedAt?: Date;
  rowsSaved?: number;
  rowsEdited?: number;
  rowsDeleted?: number;
  rowsAdded?: number;
  qualityScore?: number;
  qualityBucket?: string;
};

/** Build the review-latency + optional quality/edit patch for submit/discard. */
export function buildReviewOutcomePatch(
  input: ReviewOutcomeMetrics,
): {
  reviewDurationMs?: number;
  reviewRowsSaved?: number;
  reviewRowsEdited?: number;
  reviewRowsDeleted?: number;
  reviewRowsAdded?: number;
  qualityScore?: number;
  qualityBucket?: string;
  qualityComputedAt?: Date;
} {
  const endedAt = input.endedAt ?? new Date();
  const reviewDurationMs = computeReviewDurationMs(
    input.reviewOpenedAt,
    endedAt,
  );
  const patch: ReturnType<typeof buildReviewOutcomePatch> = {};
  if (reviewDurationMs != null) {
    patch.reviewDurationMs = reviewDurationMs;
  }
  if (input.rowsSaved != null) patch.reviewRowsSaved = input.rowsSaved;
  if (input.rowsEdited != null) patch.reviewRowsEdited = input.rowsEdited;
  if (input.rowsDeleted != null) patch.reviewRowsDeleted = input.rowsDeleted;
  if (input.rowsAdded != null) patch.reviewRowsAdded = input.rowsAdded;
  if (input.qualityScore != null && input.qualityBucket != null) {
    patch.qualityScore = input.qualityScore;
    patch.qualityBucket = input.qualityBucket;
    patch.qualityComputedAt = endedAt;
  }
  return patch;
}
