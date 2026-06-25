export type ManualRowPosition = "start" | "end";

/** One below the minimum or one above the maximum so manual rows sort first/last. */
export function sortIndexForManualRow(
  existingValues: Array<number | null | undefined>,
  position: ManualRowPosition,
): number {
  const numeric = existingValues.filter(
    (value): value is number => value != null && Number.isFinite(value),
  );

  if (numeric.length === 0) {
    return position === "start" ? -1 : 0;
  }

  const min = Math.min(...numeric);
  const max = Math.max(...numeric);
  return position === "start" ? min - 1 : max + 1;
}

/** Assign a frame index so manual rows sort at the start or end of the review list. */
export function frameIndexForManualRow(
  existingFrameIndexes: Array<number | null | undefined>,
  position: ManualRowPosition,
): number {
  return sortIndexForManualRow(existingFrameIndexes, position);
}
