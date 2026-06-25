import {
  getScoreTarget,
  isMemberRosterVideoTarget,
} from "@/lib/video/score-targets";

export type ParsedRowSortFields = {
  rank?: number | null;
  allianceRank?: number | null;
  frameIndex?: number | null;
};

/** Which nullable integer column the review GET route sorts first (before frameIndex). */
export function reviewRowPrimarySortKey(
  scoreTargetId: string | null | undefined,
): "allianceRank" | "rank" | null {
  if (!scoreTargetId) return null;
  if (isMemberRosterVideoTarget(scoreTargetId)) return "allianceRank";
  const target = getScoreTarget(scoreTargetId);
  if (!target) return null;
  if (
    target.id === "vs-performance" ||
    target.leaderboardModel === "podium-commendation"
  ) {
    return "rank";
  }
  return null;
}

/** Postgres ASC with default NULLS LAST. */
function compareNullableIntAsc(
  a: number | null | undefined,
  b: number | null | undefined,
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

/** Mirror `GET /api/tools/video-upload/[jobId]` parsed-row ordering. */
export function compareParsedRowsForReview(
  a: ParsedRowSortFields,
  b: ParsedRowSortFields,
  scoreTargetId: string | null | undefined,
): number {
  const primary = reviewRowPrimarySortKey(scoreTargetId);
  if (primary === "allianceRank") {
    const byAllianceRank = compareNullableIntAsc(a.allianceRank, b.allianceRank);
    if (byAllianceRank !== 0) return byAllianceRank;
  } else {
    const byRank = compareNullableIntAsc(a.rank, b.rank);
    if (byRank !== 0) return byRank;
  }
  return compareNullableIntAsc(a.frameIndex, b.frameIndex);
}

export function mergeParsedRowInReviewOrder<T extends ParsedRowSortFields>(
  rows: T[],
  newRow: T,
  scoreTargetId: string | null | undefined,
): T[] {
  return [...rows, newRow].sort((a, b) =>
    compareParsedRowsForReview(a, b, scoreTargetId),
  );
}
