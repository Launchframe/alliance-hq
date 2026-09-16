import { clusterByFuzzyName } from "@/lib/video/dedupe/fuzzy-name-cluster.shared";
import { nameMatchScore } from "@/lib/video/member-matcher";
import {
  foldOcrLatin,
  normalizeScoreValue,
  stripParsedNameDecorations,
} from "@/lib/video/normalize-rows";
import {
  pickBestMatchedRow,
  type MatchedParseEntry,
} from "@/lib/video/parse-row-dedup";

/**
 * Same-score OCR twins are corroborating evidence of one commander.
 * Lower than deposit-slip auto-merge (0.85) because the shared score
 * is the extra signal; keep true ties (dissimilar names) below this.
 */
export const SCORE_OCR_TWIN_SIMILARITY = 0.75;

export function normalizeScoreboardOcrName(
  raw: string,
  allianceTag?: string | null,
): string {
  return foldOcrLatin(stripParsedNameDecorations(raw, allianceTag))
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function leadingAlphaRun(normalized: string): string {
  return normalized.match(/^[a-z]+/)?.[0] ?? "";
}

/** Containment-aware score, plus identical leading alpha stems (BLAKE…). */
export function scoreboardTwinSimilarity(a: string, b: string): number {
  const scored = nameMatchScore(a, b);
  if (scored >= SCORE_OCR_TWIN_SIMILARITY) return scored;
  const runA = leadingAlphaRun(a);
  const runB = leadingAlphaRun(b);
  const shared = Math.min(runA.length, runB.length);
  if (shared >= 5 && runA.slice(0, shared) === runB.slice(0, shared)) {
    return 1;
  }
  return scored;
}

/**
 * Collapse fuzzy-similar commander names that share a normalized score.
 * Unmatched twins never reach `dedupeMatchedParseEntries`.
 */
export function dedupeSameScoreOcrTwins(
  rows: MatchedParseEntry[],
  allianceTag?: string | null,
): MatchedParseEntry[] {
  const byScore = new Map<string, MatchedParseEntry[]>();
  const unscored: MatchedParseEntry[] = [];

  for (const row of rows) {
    const score = normalizeScoreValue(row.entry.score);
    if (!score) {
      unscored.push(row);
      continue;
    }
    const group = byScore.get(score) ?? [];
    group.push(row);
    byScore.set(score, group);
  }

  const deduped: MatchedParseEntry[] = [...unscored];
  for (const group of byScore.values()) {
    if (group.length === 1) {
      deduped.push(group[0]!);
      continue;
    }

    const clusters = clusterByFuzzyName(group, (row) => row.entry.name, {
      threshold: SCORE_OCR_TWIN_SIMILARITY,
      allianceTag,
      includeSingletons: true,
      normalize: normalizeScoreboardOcrName,
      similarity: scoreboardTwinSimilarity,
    });

    for (const cluster of clusters) {
      deduped.push(
        cluster.length === 1
          ? cluster[0]!
          : pickBestMatchedRow(cluster, allianceTag),
      );
    }
  }

  return deduped;
}
