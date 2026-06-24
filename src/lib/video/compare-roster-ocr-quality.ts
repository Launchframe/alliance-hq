import { parsePowerLevelString } from "@/lib/video/roster-extract";

export type RosterCompareRow = {
  name: string;
  allianceRank: number | null;
  heroPowerM: number | null;
  memberLevel: number | null;
};

export type RosterTesseractEvalMetrics = {
  nameRecall: number;
  namePrecision: number;
  rankAgreement: number | null;
  powerAgreement: number | null;
  levelAgreement: number | null;
  primaryRowCount: number;
  shadowRowCount: number;
  rowCountDelta: number;
  matchedNameCount: number;
  onlyInPrimary: number;
  onlyInShadow: number;
};

export type RosterTesseractEvalComparison = {
  kind: "roster_tesseract_eval";
  computedAt: string;
  primaryJobId: string;
  shadowJobId: string;
  tessPassKey: string | null;
  metrics: RosterTesseractEvalMetrics;
  shadowTotalMs: number | null;
};

const NAME_MATCH_THRESHOLD = 0.6;

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
    }
  }
  return dp[m]![n]!;
}

export function rosterNameSimilarity(a: string, b: string): number {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return 0;
  const maxLen = Math.max(left.length, right.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(left, right) / maxLen;
}

export function rosterDbRowToCompareRow(row: {
  ocrName: string;
  allianceRank: number | null;
  powerLevel: string | null;
  memberLevel: number | null;
}): RosterCompareRow {
  const { heroPowerM } = parsePowerLevelString(row.powerLevel);
  return {
    name: row.ocrName,
    allianceRank: row.allianceRank,
    heroPowerM,
    memberLevel: row.memberLevel,
  };
}

type NameMatch = {
  primaryIdx: number;
  shadowIdx: number;
  similarity: number;
};

function matchNamesBySimilarity(
  primary: RosterCompareRow[],
  shadow: RosterCompareRow[],
  minSimilarity = NAME_MATCH_THRESHOLD,
): NameMatch[] {
  const candidates: NameMatch[] = [];
  for (let primaryIdx = 0; primaryIdx < primary.length; primaryIdx++) {
    for (let shadowIdx = 0; shadowIdx < shadow.length; shadowIdx++) {
      const similarity = rosterNameSimilarity(
        primary[primaryIdx]!.name,
        shadow[shadowIdx]!.name,
      );
      if (similarity >= minSimilarity) {
        candidates.push({ primaryIdx, shadowIdx, similarity });
      }
    }
  }

  candidates.sort((a, b) => b.similarity - a.similarity);

  const usedPrimary = new Set<number>();
  const usedShadow = new Set<number>();
  const matches: NameMatch[] = [];

  for (const candidate of candidates) {
    if (usedPrimary.has(candidate.primaryIdx) || usedShadow.has(candidate.shadowIdx)) {
      continue;
    }
    usedPrimary.add(candidate.primaryIdx);
    usedShadow.add(candidate.shadowIdx);
    matches.push(candidate);
  }

  return matches;
}

function fieldAgreementRate(
  matches: NameMatch[],
  primary: RosterCompareRow[],
  shadow: RosterCompareRow[],
  compare: (left: RosterCompareRow, right: RosterCompareRow) => boolean,
  hasValue: (row: RosterCompareRow) => boolean,
): number | null {
  let comparable = 0;
  let agreed = 0;

  for (const match of matches) {
    const left = primary[match.primaryIdx]!;
    const right = shadow[match.shadowIdx]!;
    if (!hasValue(left) || !hasValue(right)) continue;
    comparable++;
    if (compare(left, right)) agreed++;
  }

  return comparable > 0 ? agreed / comparable : null;
}

export function compareRosterOcrQuality(
  primary: RosterCompareRow[],
  shadow: RosterCompareRow[],
): RosterTesseractEvalMetrics {
  const matches = matchNamesBySimilarity(primary, shadow);
  const matchedNameCount = matches.length;
  const primaryRowCount = primary.length;
  const shadowRowCount = shadow.length;

  return {
    nameRecall:
      primaryRowCount > 0 ? matchedNameCount / primaryRowCount : 0,
    namePrecision:
      shadowRowCount > 0 ? matchedNameCount / shadowRowCount : 0,
    rankAgreement: fieldAgreementRate(
      matches,
      primary,
      shadow,
      (left, right) => left.allianceRank === right.allianceRank,
      (row) => row.allianceRank != null,
    ),
    powerAgreement: fieldAgreementRate(
      matches,
      primary,
      shadow,
      (left, right) => left.heroPowerM === right.heroPowerM,
      (row) => row.heroPowerM != null,
    ),
    levelAgreement: fieldAgreementRate(
      matches,
      primary,
      shadow,
      (left, right) => left.memberLevel === right.memberLevel,
      (row) => row.memberLevel != null,
    ),
    primaryRowCount,
    shadowRowCount,
    rowCountDelta: Math.abs(primaryRowCount - shadowRowCount),
    matchedNameCount,
    onlyInPrimary: primaryRowCount - matchedNameCount,
    onlyInShadow: shadowRowCount - matchedNameCount,
  };
}

export function isRosterTesseractEvalComparison(
  value: unknown,
): value is RosterTesseractEvalComparison {
  return (
    !!value &&
    typeof value === "object" &&
    (value as RosterTesseractEvalComparison).kind === "roster_tesseract_eval"
  );
}
