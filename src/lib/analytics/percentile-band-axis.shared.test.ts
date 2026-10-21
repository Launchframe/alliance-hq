import { describe, expect, it } from "vitest";

import { percentileBandAxisDomains } from "@/lib/analytics/percentile-band-axis.shared";

describe("percentileBandAxisDomains", () => {
  it("scales the alliance total independently of member percentiles", () => {
    const domains = percentileBandAxisDomains(
      [
        { total: 4_000_000_000, p50: 80_000_000, p90: 150_000_000, p99: 200_000_000 },
        { total: 15_000_000_000, p50: 90_000_000, p90: 160_000_000, p99: 210_000_000 },
      ],
      185_100_000,
    );

    expect(domains.left).toEqual([0, 500_000_000]);
    expect(domains.right).toEqual([0, 20_000_000_000]);
  });

  it("includes a viewer above P99 on the left axis only", () => {
    const domains = percentileBandAxisDomains(
      [{ total: 1_000_000_000, p50: 10, p90: 20, p99: 40 }],
      500,
    );

    expect(domains.left).toEqual([0, 1_000]);
    expect(domains.right).toEqual([0, 2_000_000_000]);
  });

  it("ignores nulls", () => {
    const domains = percentileBandAxisDomains(
      [{ total: null, p50: null, p90: 12, p99: null }],
      null,
    );

    expect(domains.left).toEqual([0, 20]);
    expect(domains.right).toBeUndefined();
  });
});
