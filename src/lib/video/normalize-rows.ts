export type OcrEntry = {
  name: string;
  score: string | number;
  rank?: number;
  /** OCR saw multiple scores for this sanitized name — user must pick one. */
  scoreConflict?: boolean;
  /** Other score values seen for the same sanitized name. */
  conflictingScores?: string[];
  /** Internal: source frame index for DB ordering; stripped before returning to callers. */
  _sourceFrameIndex?: number;
};

export function sanitizedNameKey(
  name: string,
  allianceTag?: string | null,
): string {
  return stripParsedNameDecorations(name, allianceTag).toLowerCase();
}

function pickBestDisplayEntry(
  group: OcrEntry[],
  allianceTag?: string | null,
): OcrEntry {
  const ranked = group
    .map((entry) => ({
      entry,
      stripped: stripParsedNameDecorations(entry.name, allianceTag),
      hasBrackets: entry.name.includes("["),
    }))
    .sort((a, b) => {
      if (a.hasBrackets !== b.hasBrackets) {
        return a.hasBrackets ? 1 : -1;
      }
      return a.stripped.length - b.stripped.length;
    });

  const best = ranked[0]!;
  return {
    ...best.entry,
    name: best.stripped || best.entry.name,
  };
}

export type CollapseEntriesResult = {
  entries: OcrEntry[];
  unresolvedConflicts: string[];
};

/** Prefer integer OCR scores over lossy decimal forms; break ties by digit count. */
export function scoreRepresentationRank(
  score: string,
): [integerFirst: number, digitCount: number] {
  const normalized = normalizeScoreValue(score);
  const hasDecimal = normalized.includes(".");
  const digitCount = normalized.replace(/\D/g, "").length;
  return [hasDecimal ? 0 : 1, digitCount];
}

function compareScoreRepresentationRank(a: string, b: string): number {
  const [aInt, aDigits] = scoreRepresentationRank(a);
  const [bInt, bDigits] = scoreRepresentationRank(b);
  if (aInt !== bInt) {
    return aInt - bInt;
  }
  return aDigits - bDigits;
}

function pickPreferredScore(distinctScores: string[]): string {
  return distinctScores
    .slice()
    .sort((a, b) => compareScoreRepresentationRank(b, a))[0]!;
}

function allOtherScoresAreLossyAliases(
  distinctScores: string[],
  preferred: string,
): boolean {
  if (normalizeScoreValue(preferred).includes(".")) {
    return false;
  }

  return distinctScores
    .filter((score) => score !== preferred)
    .every((score) => {
      const normalized = normalizeScoreValue(score);
      return (
        normalized.includes(".") &&
        compareScoreRepresentationRank(score, preferred) < 0
      );
    });
}

/** Collapse OCR rows that share the same sanitized player name (one member per leaderboard). */
function minSourceFrameIndex(group: OcrEntry[]): number | undefined {
  let min: number | undefined;
  for (const entry of group) {
    if (entry._sourceFrameIndex == null) continue;
    min =
      min == null
        ? entry._sourceFrameIndex
        : Math.min(min, entry._sourceFrameIndex);
  }
  return min;
}

function withEarliestFrameIndex(
  entry: OcrEntry,
  group: OcrEntry[],
): OcrEntry {
  const frameIndex = minSourceFrameIndex(group);
  return frameIndex == null ? entry : { ...entry, _sourceFrameIndex: frameIndex };
}

export function collapseEntriesBySanitizedName(
  entries: OcrEntry[],
  allianceTag?: string | null,
): CollapseEntriesResult {
  const groups = new Map<string, OcrEntry[]>();

  for (const entry of entries) {
    const key = sanitizedNameKey(entry.name, allianceTag);
    if (!key) {
      continue;
    }
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }

  const collapsed: OcrEntry[] = [];
  const unresolvedConflicts: string[] = [];

  for (const [key, group] of groups) {
    const scoreCounts = new Map<string, number>();
    for (const entry of group) {
      const score = normalizeScoreValue(entry.score);
      scoreCounts.set(score, (scoreCounts.get(score) ?? 0) + 1);
    }

    const rankedScores = [...scoreCounts.entries()].sort((a, b) => b[1] - a[1]);

    if (rankedScores.length === 1) {
      collapsed.push(
        withEarliestFrameIndex(
          {
            ...pickBestDisplayEntry(group, allianceTag),
            score: rankedScores[0]![0],
          },
          group,
        ),
      );
      continue;
    }

    const distinctScores = rankedScores.map(([score]) => score);
    const preferred = pickPreferredScore(distinctScores);

    if (allOtherScoresAreLossyAliases(distinctScores, preferred)) {
      collapsed.push(
        withEarliestFrameIndex(
          {
            ...pickBestDisplayEntry(group, allianceTag),
            score: preferred,
          },
          group,
        ),
      );
      continue;
    }

    const [topScore, topCount] = rankedScores[0]!;
    const secondCount = rankedScores[1]?.[1] ?? 0;

    if (topCount > secondCount) {
      const winners = group.filter(
        (entry) => normalizeScoreValue(entry.score) === topScore,
      );
      collapsed.push(
        withEarliestFrameIndex(
          {
            ...pickBestDisplayEntry(winners, allianceTag),
            score: topScore,
          },
          winners,
        ),
      );
      continue;
    }

    unresolvedConflicts.push(key);

    for (const score of distinctScores) {
      const scoreEntries = group.filter(
        (entry) => normalizeScoreValue(entry.score) === score,
      );
      collapsed.push(
        withEarliestFrameIndex(
          {
            ...pickBestDisplayEntry(scoreEntries, allianceTag),
            score,
            scoreConflict: true,
            conflictingScores: distinctScores.filter((value) => value !== score),
          },
          scoreEntries,
        ),
      );
    }
  }

  return { entries: collapsed, unresolvedConflicts };
}

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** Strip bracketed tags and bare alliance tag prefixes from OCR names before matching. */
export function stripParsedNameDecorations(
  name: string,
  allianceTag?: string | null,
): string {
  let result = name.trim();
  result = result.replace(/\[[^\]]*\]/g, "");

  const tag = allianceTag?.trim();
  if (tag) {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`^${escaped}(?:\\s+|)`, "i"), "");
  }

  return result.replace(/\s+/g, " ").trim();
}

export function normalizeScoreValue(score: string | number): string {
  if (typeof score === "number") {
    return Number.isInteger(score) ? String(score) : String(score);
  }
  return score.trim().replace(/,/g, "");
}

export function parseScoreNumber(score: string): number {
  const cleaned = normalizeScoreValue(score);
  const n = Number(cleaned);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid score: ${score}`);
  }
  return n;
}

export function unwrapOcrPayload(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const obj = payload as Record<string, unknown>;
  if (obj.output && typeof obj.output === "object") {
    return obj.output as Record<string, unknown>;
  }
  if (obj.data && typeof obj.data === "object") {
    return obj.data as Record<string, unknown>;
  }
  return obj;
}

export function extractEntries(payload: unknown): OcrEntry[] {
  const root = unwrapOcrPayload(payload);
  if (!root) {
    return [];
  }
  const entries = (root.entries ?? root.players) as unknown;
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map((e) => ({
      name: normalizeName(String(e.name ?? "")),
      score: e.kills != null ? String(e.kills) : normalizeScoreValue(e.score as string | number),
      rank: typeof e.rank === "number" ? e.rank : undefined,
    }))
    .filter((e) => e.name.length > 0);
}

export function dedupeEntries(entries: OcrEntry[]): OcrEntry[] {
  const byKey = new Map<string, OcrEntry>();
  for (const entry of entries) {
    const key = `${entry.name.toLowerCase()}::${normalizeScoreValue(entry.score)}`;
    if (!byKey.has(key)) {
      byKey.set(key, entry);
    }
  }
  return [...byKey.values()];
}

export function mergeOcrResults(batches: OcrEntry[][]): OcrEntry[] {
  return dedupeEntries(batches.flat());
}
