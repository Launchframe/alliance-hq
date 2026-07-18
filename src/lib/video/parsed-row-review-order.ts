import { normalizeScoreValue } from "@/lib/video/normalize-rows";
import {
  getScoreTarget,
  isMemberRosterVideoTarget,
} from "@/lib/video/score-targets";

export type ParsedRowSortFields = {
  rank?: number | null;
  allianceRank?: number | null;
  frameIndex?: number | null;
};

export type ParsedRowInitialSortFields = ParsedRowSortFields & {
  score?: string | null;
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

/** Targets that load in scoreboard order (highest score first). */
export function sortsInitialReviewByScoreDesc(
  scoreTargetId: string | null | undefined,
): boolean {
  return scoreTargetId === "desert-storm";
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

function parseScoreNumberSoft(
  score: string | null | undefined,
): number | null {
  if (score == null || score.trim() === "") return null;
  const n = Number(normalizeScoreValue(score));
  return Number.isFinite(n) ? n : null;
}

/** Highest score first; empty/invalid scores last. */
function compareScoreDesc(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const aNum = parseScoreNumberSoft(a);
  const bNum = parseScoreNumberSoft(b);
  if (aNum == null && bNum == null) return 0;
  if (aNum == null) return 1;
  if (bNum == null) return -1;
  return bNum - aNum;
}

/**
 * Ordering for add-row / merge during review. Intentionally does not sort by
 * score so edits and inserts do not reshuffle the list mid-review.
 */
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

/**
 * Initial review page load ordering. Desert Storm uses scoreboard order
 * (score DESC); other targets keep rank/frameIndex rules.
 */
export function sortParsedRowsForInitialReview<T extends ParsedRowInitialSortFields>(
  rows: T[],
  scoreTargetId: string | null | undefined,
): T[] {
  if (sortsInitialReviewByScoreDesc(scoreTargetId)) {
    return [...rows].sort((a, b) => {
      const byScore = compareScoreDesc(a.score, b.score);
      if (byScore !== 0) return byScore;
      return compareNullableIntAsc(a.frameIndex, b.frameIndex);
    });
  }
  return [...rows].sort((a, b) =>
    compareParsedRowsForReview(a, b, scoreTargetId),
  );
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
