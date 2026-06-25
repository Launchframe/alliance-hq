export type ManualRowPosition = "start" | "end";

/** Assign a frame index so manual rows sort at the start or end of the review list. */
export function frameIndexForManualRow(
  existingFrameIndexes: Array<number | null | undefined>,
  position: ManualRowPosition,
): number {
  const numeric = existingFrameIndexes.filter(
    (value): value is number => value != null && Number.isFinite(value),
  );

  if (numeric.length === 0) {
    return position === "start" ? -1 : 0;
  }

  const min = Math.min(...numeric);
  const max = Math.max(...numeric);
  return position === "start" ? min - 1 : max + 1;
}
