import { normalizeScoreValue } from "@/lib/video/normalize-rows";
import type { MatchedParseEntry } from "@/lib/video/parse-row-dedup";

export type ScoreGhostReviewRow = {
  id: string;
  ocrName: string;
  score: string | null;
  memberId: string | null;
  memberName: string | null;
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

/**
 * OCR scroll bleed: one matched row and unmatched mangled names sharing the same
 * score. Unmatched siblings are ghosts — discard on submit / strip at parse time.
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
    clusters.push({
      normalizedScore,
      keeperRowId: keeper.id,
      keeperOcrName: keeper.ocrName,
      keeperMemberName: keeper.memberName,
      ghostRowIds: bucket.unmatched.map((row) => row.id),
      ghostOcrNames: bucket.unmatched.map((row) => row.ocrName),
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

/** Drop unmatched parse entries that share a score with exactly one matched row. */
export function stripUnmatchedScoreGhostEntries(
  rows: readonly MatchedParseEntry[],
): MatchedParseEntry[] {
  const byScore = bucketByNormalizedScore(
    rows,
    (row) => String(row.entry.score ?? ""),
    (row) => row.match.memberId,
    () => false,
  );

  const ghostScores = new Set<string>();
  for (const [normalizedScore, bucket] of byScore) {
    if (bucket.matched.length === 1 && bucket.unmatched.length > 0) {
      ghostScores.add(normalizedScore);
    }
  }

  if (ghostScores.size === 0) {
    return [...rows];
  }

  return rows.filter((row) => {
    if (row.match.memberId) return true;
    const normalizedScore = normalizeScoreValue(String(row.entry.score ?? ""));
    return !normalizedScore || !ghostScores.has(normalizedScore);
  });
}
