import { stringSimilarity } from "@/lib/video/member-matcher";
import { normalizeScoreValue } from "@/lib/video/normalize-rows";
import type { MatchedParseEntry } from "@/lib/video/parse-row-dedup";

export type ScoreGhostReviewRow = {
  id: string;
  ocrName: string;
  score: string | null;
  memberId: string | null;
  memberName: string | null;
  frameIndex?: number | null;
  deleted?: boolean | number;
};

export type ScoreGhostCluster = {
  normalizedScore: string;
  keeperRowId: string;
  keeperOcrName: string;
  keeperMemberName: string | null;
  ghostRowIds: string[];
  ghostOcrNames: string[];
};

type ScoreBucket<T> = {
  matched: T[];
  unmatched: T[];
};

/** Unmatched OCR that fuzzy-matches the keeper is likely an alias, not a ghost. */
export const SCORE_GHOST_KEEPER_ALIAS_SIMILARITY_MIN = 0.55;

function isActiveRow(deleted: boolean | number | undefined): boolean {
  return deleted !== true && deleted !== 1;
}

function bucketByNormalizedScore<T>(
  rows: readonly T[],
  readScore: (row: T) => string | null,
  readMemberId: (row: T) => string | null,
  readDeleted: (row: T) => boolean | number | undefined,
): Map<string, ScoreBucket<T>> {
  const byScore = new Map<string, ScoreBucket<T>>();
  for (const row of rows) {
    if (!isActiveRow(readDeleted(row))) continue;
    const normalizedScore = normalizeScoreValue(readScore(row) ?? "");
    if (!normalizedScore) continue;
    const bucket = byScore.get(normalizedScore) ?? { matched: [], unmatched: [] };
    if (readMemberId(row)) {
      bucket.matched.push(row);
    } else {
      bucket.unmatched.push(row);
    }
    byScore.set(normalizedScore, bucket);
  }
  return byScore;
}

function keeperReferenceNames(keeper: ScoreGhostReviewRow): string[] {
  return [keeper.ocrName, keeper.memberName].filter(
    (name): name is string => Boolean(name?.trim()),
  );
}

/**
 * Scroll-bleed ghosts share a score with one matched keeper but appear on a later
 * capture frame with a different commander name. Tied players on the same frame
 * are excluded — in-game leaderboards show ties adjacent on one screen.
 */
export function isLikelyScoreGhostRow(
  keeper: ScoreGhostReviewRow,
  unmatched: ScoreGhostReviewRow,
): boolean {
  const keeperFrame = keeper.frameIndex;
  const ghostFrame = unmatched.frameIndex;

  if (keeperFrame == null || ghostFrame == null) {
    return false;
  }

  if (keeperFrame === ghostFrame) {
    return false;
  }

  if (ghostFrame <= keeperFrame) {
    return false;
  }

  for (const keeperName of keeperReferenceNames(keeper)) {
    if (
      stringSimilarity(unmatched.ocrName, keeperName) >=
      SCORE_GHOST_KEEPER_ALIAS_SIMILARITY_MIN
    ) {
      return false;
    }
  }

  return true;
}

/**
 * OCR scroll bleed: one matched row and unmatched mangled names sharing the same
 * score on later frames. Unmatched siblings are ghosts — discard on submit / strip
 * at parse time.
 */
export function findScoreGhostClusters(
  rows: readonly ScoreGhostReviewRow[],
): ScoreGhostCluster[] {
  const byScore = bucketByNormalizedScore(
    rows,
    (row) => row.score,
    (row) => row.memberId,
    (row) => row.deleted,
  );

  const clusters: ScoreGhostCluster[] = [];
  for (const [normalizedScore, bucket] of byScore) {
    if (bucket.matched.length !== 1 || bucket.unmatched.length === 0) {
      continue;
    }
    const keeper = bucket.matched[0]!;
    const ghosts = bucket.unmatched.filter((row) =>
      isLikelyScoreGhostRow(keeper, row),
    );
    if (ghosts.length === 0) {
      continue;
    }
    clusters.push({
      normalizedScore,
      keeperRowId: keeper.id,
      keeperOcrName: keeper.ocrName,
      keeperMemberName: keeper.memberName,
      ghostRowIds: ghosts.map((row) => row.id),
      ghostOcrNames: ghosts.map((row) => row.ocrName),
    });
  }

  return clusters.sort((a, b) =>
    Number.parseInt(b.normalizedScore, 10) - Number.parseInt(a.normalizedScore, 10),
  );
}

export function scoreGhostRowIdsToDiscard(
  clusters: readonly ScoreGhostCluster[],
): Set<string> {
  return new Set(clusters.flatMap((cluster) => cluster.ghostRowIds));
}

/** Drop unmatched parse entries that are scroll-bleed ghosts for a single matched row. */
export function stripUnmatchedScoreGhostEntries(
  rows: readonly MatchedParseEntry[],
): MatchedParseEntry[] {
  const reviewRows: ScoreGhostReviewRow[] = rows.map((row, index) => ({
    id: String(index),
    ocrName: row.entry.name,
    score: String(row.entry.score ?? ""),
    memberId: row.match.memberId,
    memberName: row.match.memberName,
    frameIndex: row.entry._sourceFrameIndex ?? null,
  }));

  const discardIds = scoreGhostRowIdsToDiscard(
    findScoreGhostClusters(reviewRows),
  );
  if (discardIds.size === 0) {
    return [...rows];
  }

  return rows.filter((_, index) => !discardIds.has(String(index)));
}
