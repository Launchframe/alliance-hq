import { stripParsedNameDecorations } from "@/lib/video/normalize-rows";

export type AshedMember = {
  id: string;
  current_name: string;
  previous_names?: string[];
  alliance_id?: string;
  status?: string;
  commander_sync_status?: string;
  commander_conflict?: Record<string, unknown>;
  /** Total hero power from Ashed Member entity (field name may vary). */
  total_hero_power?: number;
  totalHeroPower?: number;
  hero_power?: number;
  alliance_rank?: number;
  allianceRank?: number;
  allianceRankTitle?: string | null;
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
  /** When true, former roster members participate in matching (history import). */
  includeFormer?: boolean;
};

/** Fuzzy name similarity floor below which `matchMemberName` returns "none". */
export const MEMBER_FUZZY_AUTO_MATCH_MIN = 0.6;

/**
 * Minimum length of the shorter side for unique substring auto-match
 * (e.g. "EG" ⊂ "EG Sie", "Happy" ⊂ "Happytokill"). Shorter needles are too
 * ambiguous even when unique in a tiny roster.
 */
export const MEMBER_SUBSTRING_AUTO_MATCH_MIN_CHARS = 2;

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

/**
 * Score for typed-search / auto-match: Levenshtein plus containment and
 * token-prefix boosts (same idea as AppSelect fuzzy search).
 */
export function nameMatchScore(query: string, candidate: string): number {
  const needle = normalizeForMatch(query);
  const haystack = normalizeForMatch(candidate);
  if (!needle || !haystack) return 0;
  if (needle === haystack) return 1;

  let best = similarity(needle, haystack);

  const shorter =
    needle.length <= haystack.length ? needle : haystack;
  const longer =
    needle.length <= haystack.length ? haystack : needle;
  if (
    longer.includes(shorter) &&
    shorter.length >= MEMBER_SUBSTRING_AUTO_MATCH_MIN_CHARS
  ) {
    const ratio = shorter.length / longer.length;
    // Keep below exact/high-confidence solid green so short-name expansions
    // stay visually distinct, but clear the auto-match floor.
    best = Math.max(best, Math.min(0.92, 0.55 + 0.45 * ratio));
  }

  for (const token of haystack.split(/\s+/)) {
    if (!token) continue;
    if (
      token.startsWith(needle) &&
      needle.length >= MEMBER_SUBSTRING_AUTO_MATCH_MIN_CHARS
    ) {
      best = Math.max(
        best,
        Math.min(0.95, 0.7 + 0.25 * (needle.length / token.length)),
      );
    }
    best = Math.max(best, similarity(needle, token));
  }

  return best;
}

/** Normalized Levenshtein similarity in [0, 1] for UI fuzzy filters. */
export function stringSimilarity(a: string, b: string): number {
  return similarity(normalizeForMatch(a), normalizeForMatch(b));
}

/**
 * When pasted/OCR name and exactly one roster name contain one another,
 * auto-match (AppSelect search already surfaces these as typed hits).
 */
function findUniqueSubstringMember(
  normalized: string,
  active: AshedMember[],
): { member: AshedMember; confidence: number } | null {
  if (normalized.length < MEMBER_SUBSTRING_AUTO_MATCH_MIN_CHARS) {
    return null;
  }

  const matches = new Map<
    string,
    { member: AshedMember; confidence: number }
  >();

  for (const member of active) {
    const candidates = [
      member.current_name,
      ...(member.previous_names ?? []),
    ];
    for (const candidate of candidates) {
      const rosterName = normalizeForMatch(candidate);
      if (rosterName.length < MEMBER_SUBSTRING_AUTO_MATCH_MIN_CHARS) continue;
      if (rosterName === normalized) continue;

      const isSubstring =
        normalized.includes(rosterName) || rosterName.includes(normalized);
      if (!isSubstring) continue;

      const confidence = nameMatchScore(normalized, rosterName);
      const existing = matches.get(member.id);
      if (!existing || confidence > existing.confidence) {
        matches.set(member.id, { member, confidence });
      }
    }
  }

  if (matches.size === 1) return [...matches.values()][0] ?? null;

  // Prefer a single active member when both active and former would match.
  const activeOnly = [...matches.values()].filter(
    (row) => row.member.status !== "former",
  );
  if (activeOnly.length === 1) return activeOnly[0] ?? null;

  return null;
}

export function buildMemberIndex(
  members: AshedMember[],
  options?: { includeFormer?: boolean },
) {
  const exact = new Map<string, AshedMember>();
  const active = members.filter((m) =>
    options?.includeFormer ? true : m.status !== "former",
  );

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

  const substringHit = findUniqueSubstringMember(normalized, index.active);
  if (substringHit) {
    return {
      ocrName,
      memberId: substringHit.member.id,
      memberName: substringHit.member.current_name,
      confidence: substringHit.confidence,
      matchMethod: "fuzzy",
    };
  }

  let best: AshedMember | null = null;
  let bestScore = 0;
  let bestIsFormer = false;
  for (const member of index.active) {
    const candidates = [
      member.current_name,
      ...(member.previous_names ?? []),
    ];
    for (const candidate of candidates) {
      // Pure Levenshtein only — containment is handled by the unique-substring
      // pass above so ambiguous short names (two "Happy*" roster rows) stay unmatched.
      const score = similarity(normalized, normalizeForMatch(candidate));
      const isFormer = member.status === "former";
      if (
        score > bestScore ||
        (score === bestScore && bestIsFormer && !isFormer)
      ) {
        bestScore = score;
        best = member;
        bestIsFormer = isFormer;
      }
    }
  }

  if (best && bestScore >= MEMBER_FUZZY_AUTO_MATCH_MIN) {
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
  const index = buildMemberIndex(members, {
    includeFormer: options?.includeFormer === true,
  });
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
        const score = nameMatchScore(normalized, candidate);
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
