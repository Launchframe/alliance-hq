import { describe, expect, it } from "vitest";

import {
  aggregateUploaderScoreTargetRewards,
  buildReviewOutcomePatch,
  computeReviewDurationMs,
  isVideoHygieneEventKind,
  medianNumber,
} from "./video-hygiene-instrumentation.shared";

describe("computeReviewDurationMs", () => {
  it("returns null when review was never opened", () => {
    expect(computeReviewDurationMs(null, new Date())).toBeNull();
  });

  it("returns rounded ms between open and end", () => {
    const opened = new Date("2026-07-01T12:00:00.000Z");
    const ended = new Date("2026-07-01T12:01:30.250Z");
    expect(computeReviewDurationMs(opened, ended)).toBe(90_250);
  });

  it("returns null when end is before open", () => {
    const opened = new Date("2026-07-01T12:00:00.000Z");
    const ended = new Date("2026-07-01T11:59:00.000Z");
    expect(computeReviewDurationMs(opened, ended)).toBeNull();
  });
});

describe("medianNumber", () => {
  it("returns null for empty", () => {
    expect(medianNumber([])).toBeNull();
  });

  it("returns middle for odd length", () => {
    expect(medianNumber([3, 1, 2])).toBe(2);
  });

  it("averages middle pair for even length", () => {
    expect(medianNumber([1, 2, 3, 4])).toBe(2.5);
  });
});

describe("isVideoHygieneEventKind", () => {
  it("accepts known kinds", () => {
    expect(isVideoHygieneEventKind("coach_shown")).toBe(true);
    expect(isVideoHygieneEventKind("adapt_bias_on")).toBe(true);
  });

  it("rejects unknown kinds", () => {
    expect(isVideoHygieneEventKind("nope")).toBe(false);
  });
});

describe("aggregateUploaderScoreTargetRewards", () => {
  it("aggregates by uploader × score target", () => {
    const rows = aggregateUploaderScoreTargetRewards([
      {
        hqUserId: "u1",
        scoreTarget: "vs-performance",
        rating: "thumbs_up",
        qualityScore: 0.9,
        reviewDurationMs: 60_000,
        reviewRowsEdited: 1,
        reviewRowsDeleted: 0,
        reviewRowsAdded: 0,
        scrollStyle: "slow_steady",
      },
      {
        hqUserId: "u1",
        scoreTarget: "vs-performance",
        rating: "thumbs_down",
        qualityScore: 0.5,
        reviewDurationMs: 120_000,
        reviewRowsEdited: 3,
        reviewRowsDeleted: 1,
        reviewRowsAdded: 0,
        scrollStyle: "chaotic",
      },
      {
        hqUserId: "u1",
        scoreTarget: "desert-storm",
        rating: "thumbs_up",
        qualityScore: 1,
        reviewDurationMs: 30_000,
        reviewRowsEdited: 0,
        reviewRowsDeleted: 0,
        reviewRowsAdded: 0,
        scrollStyle: "slow_steady",
      },
    ]);

    expect(rows).toHaveLength(2);
    const vs = rows.find((r) => r.scoreTarget === "vs-performance");
    expect(vs).toMatchObject({
      hqUserId: "u1",
      jobCount: 2,
      ratedCount: 2,
      thumbsUpCount: 1,
      thumbsDownCount: 1,
      thumbsUpRate: 0.5,
      avgQualityScore: 0.7,
      medianReviewDurationMs: 90_000,
      avgRowsEdited: 2,
      scrollStyleCounts: { slow_steady: 1, chaotic: 1 },
    });
  });
});

describe("buildReviewOutcomePatch", () => {
  it("includes duration and quality when available", () => {
    const opened = new Date("2026-07-01T12:00:00.000Z");
    const ended = new Date("2026-07-01T12:00:10.000Z");
    expect(
      buildReviewOutcomePatch({
        reviewOpenedAt: opened,
        endedAt: ended,
        rowsSaved: 10,
        rowsEdited: 2,
        rowsDeleted: 1,
        rowsAdded: 0,
        qualityScore: 0.7,
        qualityBucket: "q2",
      }),
    ).toEqual({
      reviewDurationMs: 10_000,
      reviewRowsSaved: 10,
      reviewRowsEdited: 2,
      reviewRowsDeleted: 1,
      reviewRowsAdded: 0,
      qualityScore: 0.7,
      qualityBucket: "q2",
      qualityComputedAt: ended,
    });
  });

  it("omits duration when never opened", () => {
    const patch = buildReviewOutcomePatch({
      reviewOpenedAt: null,
      rowsSaved: 5,
    });
    expect(patch.reviewDurationMs).toBeUndefined();
    expect(patch.reviewRowsSaved).toBe(5);
  });
});
