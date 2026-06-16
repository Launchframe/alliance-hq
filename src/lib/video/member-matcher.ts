import { stripParsedNameDecorations } from "@/lib/video/normalize-rows";

export type AshedMember = {
  id: string;
  current_name: string;
  previous_names?: string[];
  alliance_id?: string;
  status?: string;
  /** Total hero power from Ashed Member entity (field name may vary). */
  total_hero_power?: number;
  totalHeroPower?: number;
  hero_power?: number;
  alliance_rank?: number;
  allianceRank?: number;
  /** Ashed stores in-game rank as "R1"–"R5" or "" when unset. */
  rank?: number | string;
  member_rank?: number;
};

export type MemberMatch = {
  ocrName: string;
  memberId: string | null;
  memberName: string | null;
  confidence: number;
  matchMethod: "exact" | "previous_name" | "fuzzy" | "none";
};

export type MemberMatchOptions = {
  allianceTag?: string | null;
};

function normalizeForMatch(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function nameForMatching(ocrName: string, allianceTag?: string | null): string {
  const stripped = stripParsedNameDecorations(ocrName, allianceTag);
  return normalizeForMatch(stripped || ocrName);
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

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

export function buildMemberIndex(members: AshedMember[]) {
  const exact = new Map<string, AshedMember>();
  const active = members.filter((m) => m.status !== "former");

  for (const member of active) {
    exact.set(normalizeForMatch(member.current_name), member);
    for (const prev of member.previous_names ?? []) {
      exact.set(normalizeForMatch(prev), member);
    }
  }

  return { exact, active };
}

export function matchMemberName(
  ocrName: string,
  index: ReturnType<typeof buildMemberIndex>,
  options?: MemberMatchOptions,
): MemberMatch {
  const normalized = nameForMatching(ocrName, options?.allianceTag);
  const exact = index.exact.get(normalized);
  if (exact) {
    const method =
      normalizeForMatch(exact.current_name) === normalized
        ? "exact"
        : "previous_name";
    return {
      ocrName,
      memberId: exact.id,
      memberName: exact.current_name,
      confidence: method === "exact" ? 1 : 0.95,
      matchMethod: method,
    };
  }

  let best: AshedMember | null = null;
  let bestScore = 0;
  for (const member of index.active) {
    const candidates = [
      member.current_name,
      ...(member.previous_names ?? []),
    ];
    for (const candidate of candidates) {
      const score = similarity(normalized, normalizeForMatch(candidate));
      if (score > bestScore) {
        bestScore = score;
        best = member;
      }
    }
  }

  if (best && bestScore >= 0.6) {
    return {
      ocrName,
      memberId: best.id,
      memberName: best.current_name,
      confidence: bestScore,
      matchMethod: "fuzzy",
    };
  }

  return {
    ocrName,
    memberId: null,
    memberName: null,
    confidence: 0,
    matchMethod: "none",
  };
}

export function matchAllNames(
  ocrNames: string[],
  members: AshedMember[],
  options?: MemberMatchOptions,
): MemberMatch[] {
  const index = buildMemberIndex(members);
  return ocrNames.map((name) => matchMemberName(name, index, options));
}

export function findFuzzyMemberCandidates(
  name: string,
  members: AshedMember[],
  options?: MemberMatchOptions & { limit?: number; minConfidence?: number },
): Array<{ memberId: string; name: string; confidence: number }> {
  const normalized = nameForMatching(name, options?.allianceTag);
  const limit = options?.limit ?? 5;
  const minConfidence = options?.minConfidence ?? 0.55;
  const active = members.filter((m) => m.status !== "former");

  return active
    .map((member) => {
      const candidates = [member.current_name, ...(member.previous_names ?? [])];
      let bestScore = 0;
      for (const candidate of candidates) {
        const score = similarity(normalized, normalizeForMatch(candidate));
        if (score > bestScore) bestScore = score;
      }
      return {
        memberId: member.id,
        name: member.current_name,
        confidence: bestScore,
      };
    })
    .filter((row) => row.confidence >= minConfidence)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}
