import { clusterByFuzzyName } from "@/lib/video/dedupe/fuzzy-name-cluster.shared";
import { stringSimilarity } from "@/lib/video/member-matcher";
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
 * is the extra signal. Containment (`Chris` ⊂ `Christina`) is not enough —
 * that would collapse true ties. Short Levenshtein hits (`Mike`/`Mikey`)
 * are also kept below this unless an OCR-junk heuristic fires.
 */
export const SCORE_OCR_TWIN_SIMILARITY = 0.75;

/** Levenshtein on short names is too loose (1 edit on 4–5 letters ≥ 0.75). */
const SCORE_OCR_TWIN_LEVENSHTEIN_MIN_CHARS = 8;

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

function firstToken(normalized: string): string {
  return normalized.split(/\s+/).find(Boolean) ?? "";
}

/** Same commander token plus leftover OCR debris (`purple` / `purple pwdx`). */
function isSameCommanderTokenWithOcrDebris(a: string, b: string): boolean {
  const tokensA = a.split(/\s+/).filter(Boolean);
  const tokensB = b.split(/\s+/).filter(Boolean);
  const firstA = tokensA[0] ?? "";
  const firstB = tokensB[0] ?? "";
  if (firstA.length < 3 || firstA !== firstB) return false;
  return (
    tokensA.length !== tokensB.length ||
    tokensA.slice(1).join("\0") !== tokensB.slice(1).join("\0")
  );
}

/**
 * Shared leading letters with leftover on both sides (`blake2bq9s` /
 * `blakezbogs`) or a digit-y remainder (`blake` / `blake2bq9s`).
 * A clean suffix (`chris` / `christina`) does not count.
 */
function isSharedStemWithOcrRemainder(a: string, b: string): boolean {
  const tokenA = firstToken(a);
  const tokenB = firstToken(b);
  const runA = leadingAlphaRun(tokenA);
  const runB = leadingAlphaRun(tokenB);
  const shared = Math.min(runA.length, runB.length);
  if (shared < 5 || runA.slice(0, shared) !== runB.slice(0, shared)) {
    return false;
  }
  const restA = tokenA.slice(shared);
  const restB = tokenB.slice(shared);
  if (restA.length > 0 && restB.length > 0) return true;
  return /\d/.test(restA) || /\d/.test(restB);
}

/** Levenshtein on long strings, plus OCR-junk heuristics — not containment. */
export function scoreboardTwinSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (isSameCommanderTokenWithOcrDebris(a, b)) return 1;
  if (isSharedStemWithOcrRemainder(a, b)) return 1;

  const scored = stringSimilarity(a, b);
  if (
    Math.min(a.length, b.length) >= SCORE_OCR_TWIN_LEVENSHTEIN_MIN_CHARS &&
    scored >= SCORE_OCR_TWIN_SIMILARITY
  ) {
    return scored;
  }
  return Math.min(scored, SCORE_OCR_TWIN_SIMILARITY - 0.01);
}

function distinctMatchedMemberIds(row: MatchedParseEntry): string | null {
  const id = row.match.memberId?.trim();
  return id || null;
}

/**
 * Collapse fuzzy-similar commander names that share a normalized score.
 * Unmatched twins never reach `dedupeMatchedParseEntries`.
 * Rows already matched to two different members are never merged.
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
      canUnion: (left, right) => {
        const idA = distinctMatchedMemberIds(left);
        const idB = distinctMatchedMemberIds(right);
        return !idA || !idB || idA === idB;
      },
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
