import { describe, expect, it } from "vitest";

import { clampReviewIndexAfterRemove } from "@/lib/banks/city-list-import-review.shared";

describe("clampReviewIndexAfterRemove", () => {
  it("returns 0 when all rows are removed", () => {
    expect(clampReviewIndexAfterRemove(2, 1, 0)).toBe(0);
  });

  it("decrements index when a row before the current one is removed", () => {
    expect(clampReviewIndexAfterRemove(3, 1, 4)).toBe(2);
  });

  it("keeps index when the current row is removed and a successor exists", () => {
    expect(clampReviewIndexAfterRemove(2, 2, 4)).toBe(2);
  });

  it("clamps to the last row when the final row is removed", () => {
    expect(clampReviewIndexAfterRemove(4, 4, 4)).toBe(3);
  });
});
