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

/**
 * From weekly-total Ashed payloads, keep only members with full Days 1–5
 * coverage and replace `score` with the interpolated Day 6 delta.
 */
export function interpolateVsDay6SubmitPayloads(
  weeklyPayloads: Record<string, unknown>[],
  coverageByMemberId: ReadonlyMap<string, VsDay6Coverage>,
): Record<string, unknown>[] {
  const interpolated: Record<string, unknown>[] = [];
  for (const row of weeklyPayloads) {
    const memberId =
      typeof row.member_id === "string" ? row.member_id : null;
    const weeklyScore =
      typeof row.score === "number" ? row.score : Number(row.score);
    if (!memberId || !Number.isFinite(weeklyScore)) continue;
    const result = deriveVsDay6Score(
      weeklyScore,
      coverageByMemberId.get(memberId),
    );
    if (result.status !== "derived") continue;
    interpolated.push({ ...row, score: result.derivedScore });
  }
  return interpolated;
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
