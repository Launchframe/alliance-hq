import { describe, expect, it } from "vitest";

import { selectVideoHygieneCoachTip } from "./video-hygiene-coach.shared";

describe("selectVideoHygieneCoachTip", () => {
  it("returns null with fewer than 2 jobs", () => {
    expect(
      selectVideoHygieneCoachTip({
        jobCount: 1,
        thumbsUpRate: 0,
        avgQualityScore: 0,
        medianReviewDurationMs: 999_999,
        scrollStyleCounts: { chaotic: 1 },
      }),
    ).toBeNull();
  });

  it("prioritizes chaotic scroll", () => {
    expect(
      selectVideoHygieneCoachTip({
        jobCount: 5,
        thumbsUpRate: 1,
        avgQualityScore: 1,
        medianReviewDurationMs: 10_000,
        scrollStyleCounts: { chaotic: 3, slow_steady: 1 },
      }),
    ).toBe("chaoticScroll");
  });

  it("suggests thumbsDown when ratings are poor", () => {
    expect(
      selectVideoHygieneCoachTip({
        jobCount: 4,
        thumbsUpRate: 0.25,
        avgQualityScore: 0.8,
        medianReviewDurationMs: 10_000,
        scrollStyleCounts: { slow_steady: 4 },
      }),
    ).toBe("thumbsDown");
  });

  it("suggests lowQuality when avg quality is poor", () => {
    expect(
      selectVideoHygieneCoachTip({
        jobCount: 3,
        thumbsUpRate: 0.8,
        avgQualityScore: 0.3,
        medianReviewDurationMs: 10_000,
        scrollStyleCounts: {},
      }),
    ).toBe("lowQuality");
  });

  it("suggests longReview for slow median review", () => {
    expect(
      selectVideoHygieneCoachTip({
        jobCount: 3,
        thumbsUpRate: 0.8,
        avgQualityScore: 0.8,
        medianReviewDurationMs: 5 * 60 * 1000,
        scrollStyleCounts: { slow_steady: 2 },
      }),
    ).toBe("longReview");
  });

  it("reinforces steady scroll when healthy", () => {
    expect(
      selectVideoHygieneCoachTip({
        jobCount: 3,
        thumbsUpRate: 0.9,
        avgQualityScore: 0.9,
        medianReviewDurationMs: 60_000,
        scrollStyleCounts: { slow_steady: 3 },
      }),
    ).toBe("defaultSteady");
  });
});
