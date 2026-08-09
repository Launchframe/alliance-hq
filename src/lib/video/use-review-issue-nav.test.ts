import { describe, expect, it } from "vitest";

import { wrapProblemIndex } from "@/lib/video/use-review-issue-nav";

describe("wrapProblemIndex", () => {
  it("wraps out-of-range indices after the problem list shrinks", () => {
    expect(wrapProblemIndex(9, 3)).toBe(0);
    expect(wrapProblemIndex(10, 3)).toBe(1);
    expect(wrapProblemIndex(-1, 3)).toBe(2);
  });

  it("returns 0 for an empty problem list", () => {
    expect(wrapProblemIndex(5, 0)).toBe(0);
  });
});
