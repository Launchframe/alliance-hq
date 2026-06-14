import { describe, expect, it } from "vitest";

import { mapWithConcurrency } from "@/lib/video/map-with-concurrency";

describe("mapWithConcurrency", () => {
  it("returns results in input order", async () => {
    const out = await mapWithConcurrency([1, 2, 3], 2, async (n) => n * 2);
    expect(out).toEqual([2, 4, 6]);
  });

  it("limits in-flight work to the concurrency cap", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 3, async (n) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return n;
    });

    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1);
  });
});
