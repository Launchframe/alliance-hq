import { describe, expect, it } from "vitest";

import {
  computePercentile,
  computePercentileSeries,
  percentileAt,
} from "@/lib/analytics/percentile.shared";

describe("percentile.shared", () => {
  it("computes viewer percentile rank", () => {
    const result = computePercentile([10, 20, 30, 40, 50], 25);
    expect(result).toEqual({ rank: 4, count: 5, percentile: 40 });
  });

  it("returns null for fewer than two values", () => {
    expect(computePercentile([10], 10)).toBeNull();
  });

  it("computes percentile at index", () => {
    expect(percentileAt([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentileAt([1, 2, 3, 4, 5], 90)).toBe(5);
  });

  it("computes daily percentile series", () => {
    const series = computePercentileSeries([
      [10, 20, 30],
      [100, 200],
    ]);
    expect(series[0]?.total).toBe(60);
    expect(series[0]?.p50).toBe(20);
    expect(series[1]?.total).toBe(300);
  });
});
