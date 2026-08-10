export const VS_DAY6_REQUIRED_COVERAGE_DAYS = 5;

export type VsDay6Coverage = { total: number; daysCovered: number };

export type VsDay6DerivationResult =
  | { status: "derived"; derivedScore: number }
  | { status: "insufficient_data" };

export function deriveVsDay6Score(
  rawCumulativeScore: number,
  coverage: VsDay6Coverage | undefined,
): VsDay6DerivationResult {
  if (!coverage || coverage.daysCovered < VS_DAY6_REQUIRED_COVERAGE_DAYS) {
    return { status: "insufficient_data" };
  }
  return {
    status: "derived",
    derivedScore: rawCumulativeScore - coverage.total,
  };
}

/** Parse OCR/review score text to a finite number, or null when invalid. */
export function parseVsReviewScoreText(scoreText: string | null | undefined): number | null {
  if (scoreText == null || scoreText.trim() === "") return null;
  const num = Number(scoreText.replace(/,/g, ""));
  return Number.isFinite(num) ? num : null;
}

/** Format a derived VS score for the review table input. */
export function formatVsDay6DerivedScore(score: number): string {
  return String(Math.round(score));
}
