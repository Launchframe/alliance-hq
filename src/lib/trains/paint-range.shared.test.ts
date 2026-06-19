import { describe, expect, it } from "vitest";

import { expandPaintRange } from "@/lib/trains/paint-range.shared";

describe("expandPaintRange", () => {
  it("returns a single day when anchor equals focus", () => {
    expect(expandPaintRange("2026-06-10", "2026-06-10")).toEqual([
      "2026-06-10",
    ]);
  });

  it("expands forward across a week", () => {
    expect(expandPaintRange("2026-06-09", "2026-06-12")).toEqual([
      "2026-06-09",
      "2026-06-10",
      "2026-06-11",
      "2026-06-12",
    ]);
  });

  it("expands backward when focus is before anchor", () => {
    expect(expandPaintRange("2026-06-12", "2026-06-09")).toEqual([
      "2026-06-12",
      "2026-06-11",
      "2026-06-10",
      "2026-06-09",
    ]);
  });
});
