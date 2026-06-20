export const WEEK_CAROUSEL_MAX_DAYS = 42;
export const WEEK_CAROUSEL_TRIM_DAYS = 7;
export const WEEK_CAROUSEL_EDGE_THRESHOLD = 2;

export type CarouselTrimPlan = {
  trimFromStart: boolean;
  shiftDelta: number;
  newLength: number;
};

/** Pure trim plan for the infinite week carousel window. */
export function computeCarouselTrim(
  length: number,
  focusedIndex: number,
  maxDays = WEEK_CAROUSEL_MAX_DAYS,
  trimDays = WEEK_CAROUSEL_TRIM_DAYS,
): CarouselTrimPlan | null {
  if (length <= maxDays) return null;

  if (focusedIndex > length / 2) {
    return {
      trimFromStart: true,
      shiftDelta: -trimDays,
      newLength: length - trimDays,
    };
  }

  return {
    trimFromStart: false,
    shiftDelta: 0,
    newLength: length - trimDays,
  };
}

export function adjustFocusedIndexAfterPrepend(
  focusedIndex: number,
  prepended: number,
): number {
  return prepended > 0 ? focusedIndex + prepended : focusedIndex;
}
