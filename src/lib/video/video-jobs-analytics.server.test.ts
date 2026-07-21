import { describe, expect, it } from "vitest";

import { clampVideoJobsAnalyticsDays } from "./video-jobs-analytics.server";

describe("clampVideoJobsAnalyticsDays", () => {
  it("returns 0 for non-positive or non-finite input", () => {
    expect(clampVideoJobsAnalyticsDays(0)).toBe(0);
    expect(clampVideoJobsAnalyticsDays(-5)).toBe(0);
    expect(clampVideoJobsAnalyticsDays(Number.NaN)).toBe(0);
    expect(clampVideoJobsAnalyticsDays(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("truncates and caps large values at 365", () => {
    expect(clampVideoJobsAnalyticsDays(30.9)).toBe(30);
    expect(clampVideoJobsAnalyticsDays(9999)).toBe(365);
  });
});
