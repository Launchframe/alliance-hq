import { describe, expect, it } from "vitest";

import {
  adjustFocusedIndexAfterPrepend,
  computeCarouselTrim,
  WEEK_CAROUSEL_EDGE_THRESHOLD,
  WEEK_CAROUSEL_MAX_DAYS,
  WEEK_CAROUSEL_TRIM_DAYS,
} from "@/lib/client/week-schedule-carousel-window";

describe("week-schedule-carousel-window", () => {
  it("returns null when within max window", () => {
    expect(
      computeCarouselTrim(WEEK_CAROUSEL_MAX_DAYS, 10),
    ).toBeNull();
  });

  it("trims from start when focus is in the upper half", () => {
    expect(computeCarouselTrim(43, 30)).toEqual({
      trimFromStart: true,
      shiftDelta: -WEEK_CAROUSEL_TRIM_DAYS,
      newLength: 36,
    });
  });

  it("trims from end when focus is in the lower half", () => {
    expect(computeCarouselTrim(43, 10)).toEqual({
      trimFromStart: false,
      shiftDelta: 0,
      newLength: 36,
    });
  });

  it("adjusts focused index after prepending days", () => {
    expect(adjustFocusedIndexAfterPrepend(2, 7)).toBe(9);
    expect(adjustFocusedIndexAfterPrepend(5, 0)).toBe(5);
  });

  it("edge threshold constant matches infinite-days hook", () => {
    expect(WEEK_CAROUSEL_EDGE_THRESHOLD).toBe(2);
  });
});
