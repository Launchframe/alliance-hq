/** High-confidence / exact-style matches keep a solid green border. */
const HIGH_CONFIDENCE = 0.9;

/**
 * Border class for Matched Member selects.
 * Positive confidence is an accepted match: exact/high (≥0.9) solid green;
 * partial fuzzy matches use dashed green so they don't look unmatched.
 */
export function memberMatchConfidenceBorderClass(
  confidence: number | null | undefined,
): string {
  if (confidence == null || confidence <= 0) {
    return "border-hq-danger";
  }
  if (confidence >= HIGH_CONFIDENCE) {
    return "border-hq-green";
  }
  return "border-hq-green border-dashed";
}
