/**
 * Border class for Matched Member selects.
 * Any positive confidence is a valid accepted match (green) — partial fuzzy
 * matches must not look unmatched vs exact matches.
 */
export function memberMatchConfidenceBorderClass(
  confidence: number | null | undefined,
): string {
  if (confidence == null || confidence <= 0) {
    return "border-hq-danger";
  }
  return "border-hq-green";
}
