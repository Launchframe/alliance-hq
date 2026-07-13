/** Clamp mobile stepper index after a review row is removed. */
export function clampReviewIndexAfterRemove(
  currentIndex: number,
  removedIndex: number,
  nextLength: number,
): number {
  if (nextLength <= 0) return 0;
  if (currentIndex > removedIndex) return currentIndex - 1;
  return Math.min(currentIndex, nextLength - 1);
}
