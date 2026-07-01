import { describe, expect, it } from "vitest";

import { computeVrPercentile } from "@/lib/vr/percentile";

describe("computeVrPercentile", () => {
  it("returns null when fewer than two reporters", () => {
    expect(computeVrPercentile([5000], 5000)).toBeNull();
    expect(computeVrPercentile([], 5000)).toBeNull();
  });

  it("ranks highest VR as 1 and computes at-or-below percentile", () => {
    const values = [5000, 6000, 7000, 8000];
    expect(computeVrPercentile(values, 8000)).toEqual({
      rank: 1,
      reporterCount: 4,
      percentile: 100,
    });
    expect(computeVrPercentile(values, 5000)).toEqual({
      rank: 4,
      reporterCount: 4,
      percentile: 25,
    });
  });

  it("ties count all members at or below the viewer", () => {
    const values = [5000, 5000, 7000];
    expect(computeVrPercentile(values, 5000)).toEqual({
      rank: 2,
      reporterCount: 3,
      percentile: 67,
    });
  });
});
