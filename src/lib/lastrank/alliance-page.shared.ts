import { normalizeCommanderName } from "@/lib/members/commander-identity-conflicts.shared";
import {
  MEMBER_FUZZY_AUTO_MATCH_MIN,
  stringSimilarity,
} from "@/lib/video/member-matcher";

/** LastRank's own catalog id — not a Last War game UID. */
export type LastRankAllianceMember = {
  publicId: number;
  name: string;
  country: string | null;
  power: number | null;
  heroPower: number | null;
  allianceRank: number | null;
  baseLevel: number | null;
  originServerId: number | null;
};

export type LastRankAlliancePage = {
  lastrankAllianceId: string;
  members: LastRankAllianceMember[];
};

export type LastRankHqRosterRow = {
  commanderId: string;
  ashedMemberId: string;
  gameUid: string | null;
  /** Current roster name, primary name, and stored canonical (when set). */
  currentNames: string[];
  previousNames: string[];
  hqThp: number | null;
  hqLevel: number | null;
  hqPowerLevel: string | null;
  hqAllianceRank: number | null;
  existingCanonicalName: string | null;
  lastrankPublicId: number | null;
  lastrankCountry: string | null;
  lastrankProfileImageUrl: string | null;
  lastrankProfileUrl: string | null;
};

export type LastRankMatchMethod =
  | "lastrank_public_id"
  | "exact_current"
  | "exact_previous"
  | "fuzzy_current"
  | "fuzzy_previous"
  | "interactive";

export type LastRankMatchStatus =
  | "matched"
  | "unmatched"
  | "ambiguous"
  | "former_skipped";

export type LastRankMatchedRow = {
  status: "matched";
  lastRank: LastRankAllianceMember;
  hq: LastRankHqRosterRow;
  matchMethod: LastRankMatchMethod;
  fuzzyScore: number | null;
};

export type LastRankUnmatchedRow = {
  status: "unmatched" | "ambiguous";
  lastRank: LastRankAllianceMember;
  hqCommanderIds: string[];
  /** Best fuzzy scores against current/previous for operator hints. */
  suggestions: Array<{
    commanderId: string;
    name: string;
    score: number;
  }>;
};

export type LastRankMatchResult = {
  matched: LastRankMatchedRow[];
  unmatched: LastRankUnmatchedRow[];
  unmatchedHq: LastRankHqRosterRow[];
};

export const LASTRANK_FUZZY_MATCH_MIN = MEMBER_FUZZY_AUTO_MATCH_MIN;

const LASTRANK_ALLIANCE_ID_RE = /^[a-f0-9]{32}$/i;

export function isLastRankAllianceId(value: string): boolean {
  return LASTRANK_ALLIANCE_ID_RE.test(value.trim());
}

export function lastRankAllianceUrl(lastrankAllianceId: string): string {
  return `https://lastrank.fun/a/${lastrankAllianceId.trim().toLowerCase()}`;
}

export function lastRankPlayerProfileUrl(publicId: number): string {
  return `https://lastrank.fun/p/${Math.round(publicId)}`;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseRawMember(raw: unknown): LastRankAllianceMember | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const publicId = asFiniteNumber(row.public_id);
  if (!name || publicId == null) return null;
  return {
    publicId: Math.round(publicId),
    name,
    country: typeof row.country === "string" ? row.country : null,
    power: asFiniteNumber(row.power),
    heroPower: asFiniteNumber(row.hero_power),
    allianceRank: asFiniteNumber(row.alliance_rank),
    baseLevel: asFiniteNumber(row.base_level),
    originServerId: asFiniteNumber(row.origin_server_id),
  };
}

function walkForMembers(node: unknown, depth = 0): LastRankAllianceMember[] | null {
  if (depth > 40 || node == null) return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = walkForMembers(child, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== "object") return null;
  const rec = node as Record<string, unknown>;
  if (Array.isArray(rec.members) && rec.members.length > 0) {
    const parsed = rec.members
      .map(parseRawMember)
      .filter((row): row is LastRankAllianceMember => row != null);
    if (parsed.length > 0 && parsed[0].heroPower != null) {
      return parsed;
    }
  }
  for (const value of Object.values(rec)) {
    const found = walkForMembers(value, depth + 1);
    if (found) return found;
  }
  return null;
}

function parseJsonValueAt(source: string, start: number): unknown {
  if (source[start] !== "[") {
    throw new SyntaxError("expected array");
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(source.slice(start, i + 1));
      }
    }
  }
  throw new SyntaxError("unterminated JSON array");
}

function decodeNextFlightPush(rawArgs: unknown): unknown {
  if (!Array.isArray(rawArgs) || rawArgs.length < 2) return rawArgs;
  const payload = rawArgs[1];
  if (typeof payload !== "string") return rawArgs;
  const colon = payload.indexOf(":");
  const jsonPart = colon >= 0 ? payload.slice(colon + 1) : payload;
  try {
    return JSON.parse(jsonPart);
  } catch {
    return rawArgs;
  }
}

/**
 * Collapsible roster sections are headed by an `R1`–`R5` badge; members in that
 * table inherit that rank. Returns publicId → rank (1–5).
 */
export function parseLastRankSectionRanks(
  html: string,
): Map<number, number> {
  const out = new Map<number, number>();
  const sectionRe = /<section\b[^>]*>[\s\S]*?<\/section>/gi;
  let sectionMatch: RegExpExecArray | null;
  while ((sectionMatch = sectionRe.exec(html))) {
    const chunk = sectionMatch[0];
    const badge =
      chunk.match(
        /<span\b[^>]*class="[^"]*\bfont-mono\b[^"]*\bfont-bold\b[^"]*"[^>]*>\s*R([1-5])\s*<\/span>/i,
      ) ??
      chunk.match(
        /<span\b[^>]*class="[^"]*\bfont-bold\b[^"]*\bfont-mono\b[^"]*"[^>]*>\s*R([1-5])\s*<\/span>/i,
      );
    if (!badge?.[1]) continue;
    const rank = Number(badge[1]);
    if (!Number.isInteger(rank) || rank < 1 || rank > 5) continue;
    for (const player of chunk.matchAll(/href="\/p\/(\d+)"/g)) {
      const publicId = Number(player[1]);
      if (Number.isFinite(publicId)) {
        out.set(publicId, rank);
      }
    }
  }
  return out;
}

export function applySectionRanksToMembers(
  members: LastRankAllianceMember[],
  sectionRanks: Map<number, number>,
): LastRankAllianceMember[] {
  if (sectionRanks.size === 0) return members;
  return members.map((member) => {
    const fromSection = sectionRanks.get(member.publicId);
    if (fromSection == null) return member;
    return { ...member, allianceRank: fromSection };
  });
}

export function parseLastRankAllianceHtml(
  html: string,
  lastrankAllianceId: string,
): LastRankAlliancePage {
  if (
    html.includes("cf-mitigated") ||
    html.includes("Just a moment") ||
    html.includes("challenge-platform")
  ) {
    throw new Error("LastRank returned a Cloudflare challenge page");
  }

  const marker = "self.__next_f.push(";
  let from = 0;
  while (from < html.length) {
    const idx = html.indexOf(marker, from);
    if (idx < 0) break;
    const jsonStart = idx + marker.length;
    if (html[jsonStart] !== "[") {
      from = jsonStart;
      continue;
    }
    try {
      const rawArgs = parseJsonValueAt(html, jsonStart);
      const tree = decodeNextFlightPush(rawArgs);
      const members = walkForMembers(tree);
      if (members && members.length > 0) {
        const sectionRanks = parseLastRankSectionRanks(html);
        return {
          lastrankAllianceId: lastrankAllianceId.trim().toLowerCase(),
          members: applySectionRanksToMembers(members, sectionRanks),
        };
      }
    } catch {
      // try the next flight chunk
    }
    from = jsonStart + 1;
  }

  throw new Error("LastRank HTML did not contain alliance member stats");
}

export function formatLastRankPowerLevel(power: number | null): string | null {
  if (power == null || !Number.isFinite(power) || power <= 0) return null;
  const millions = power / 1_000_000;
  const decimals = millions >= 10 ? 1 : 2;
  const factor = 10 ** decimals;
  const rounded = Math.round(millions * factor) / factor;
  return `${rounded}M`;
}

function uniqueByCommander(
  rows: LastRankHqRosterRow[],
): LastRankHqRosterRow[] {
  return [...new Map(rows.map((row) => [row.commanderId, row])).values()];
}

function exactHits(
  canon: string,
  hqRows: LastRankHqRosterRow[],
  claimed: Set<string>,
  field: "currentNames" | "previousNames",
): LastRankHqRosterRow[] {
  const key = normalizeCommanderName(canon);
  if (!key) return [];
  const hits: LastRankHqRosterRow[] = [];
  for (const hq of hqRows) {
    if (claimed.has(hq.commanderId)) continue;
    for (const name of hq[field]) {
      if (normalizeCommanderName(name) === key) {
        hits.push(hq);
        break;
      }
    }
  }
  return uniqueByCommander(hits);
}

function fuzzyHits(
  canon: string,
  hqRows: LastRankHqRosterRow[],
  claimed: Set<string>,
  field: "currentNames" | "previousNames",
  minScore: number,
): Array<{ hq: LastRankHqRosterRow; score: number; matchedName: string }> {
  const scored: Array<{
    hq: LastRankHqRosterRow;
    score: number;
    matchedName: string;
  }> = [];
  for (const hq of hqRows) {
    if (claimed.has(hq.commanderId)) continue;
    let bestScore = 0;
    let bestName = "";
    for (const name of hq[field]) {
      const score = stringSimilarity(canon, name);
      if (score > bestScore) {
        bestScore = score;
        bestName = name;
      }
    }
    if (bestScore >= minScore && bestName) {
      scored.push({ hq, score: bestScore, matchedName: bestName });
    }
  }
  return scored;
}

function buildSuggestions(
  canon: string,
  hqRows: LastRankHqRosterRow[],
  claimed: Set<string>,
  limit = 5,
): LastRankUnmatchedRow["suggestions"] {
  const scored: LastRankUnmatchedRow["suggestions"] = [];
  for (const hq of hqRows) {
    if (claimed.has(hq.commanderId)) continue;
    const names = [...hq.currentNames, ...hq.previousNames];
    let bestScore = 0;
    let bestName = hq.currentNames[0] ?? hq.previousNames[0] ?? "";
    for (const name of names) {
      const score = stringSimilarity(canon, name);
      if (score > bestScore) {
        bestScore = score;
        bestName = name;
      }
    }
    if (bestName) {
      scored.push({
        commanderId: hq.commanderId,
        name: bestName,
        score: bestScore,
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * Cascading match with LastRank name as canon:
 * 1. exact current names
 * 2. exact previous names
 * 3. fuzzy current names
 * 4. fuzzy previous names
 *
 * Does not prompt — interactive resolution is a separate pass.
 */
export function matchLastRankMembersToHq(
  lastRankMembers: LastRankAllianceMember[],
  hqRows: LastRankHqRosterRow[],
  options?: { fuzzyMinScore?: number },
): LastRankMatchResult {
  const fuzzyMin = options?.fuzzyMinScore ?? LASTRANK_FUZZY_MATCH_MIN;
  const claimed = new Set<string>();
  const matched: LastRankMatchedRow[] = [];
  const unmatched: LastRankUnmatchedRow[] = [];

  for (const lastRank of lastRankMembers) {
    const publicIdHits = hqRows.filter(
      (hq) =>
        !claimed.has(hq.commanderId) &&
        hq.lastrankPublicId != null &&
        hq.lastrankPublicId === lastRank.publicId,
    );
    const publicUnique = uniqueByCommander(publicIdHits);
    if (publicUnique.length === 1) {
      claimed.add(publicUnique[0].commanderId);
      matched.push({
        status: "matched",
        lastRank,
        hq: publicUnique[0],
        matchMethod: "lastrank_public_id",
        fuzzyScore: null,
      });
      continue;
    }
    if (publicUnique.length > 1) {
      unmatched.push({
        status: "ambiguous",
        lastRank,
        hqCommanderIds: publicUnique.map((row) => row.commanderId),
        suggestions: buildSuggestions(lastRank.name, hqRows, claimed),
      });
      continue;
    }

    const exactCurrent = exactHits(
      lastRank.name,
      hqRows,
      claimed,
      "currentNames",
    );
    if (exactCurrent.length === 1) {
      claimed.add(exactCurrent[0].commanderId);
      matched.push({
        status: "matched",
        lastRank,
        hq: exactCurrent[0],
        matchMethod: "exact_current",
        fuzzyScore: null,
      });
      continue;
    }
    if (exactCurrent.length > 1) {
      unmatched.push({
        status: "ambiguous",
        lastRank,
        hqCommanderIds: exactCurrent.map((row) => row.commanderId),
        suggestions: buildSuggestions(lastRank.name, hqRows, claimed),
      });
      continue;
    }

    const exactPrevious = exactHits(
      lastRank.name,
      hqRows,
      claimed,
      "previousNames",
    );
    if (exactPrevious.length === 1) {
      claimed.add(exactPrevious[0].commanderId);
      matched.push({
        status: "matched",
        lastRank,
        hq: exactPrevious[0],
        matchMethod: "exact_previous",
        fuzzyScore: null,
      });
      continue;
    }
    if (exactPrevious.length > 1) {
      unmatched.push({
        status: "ambiguous",
        lastRank,
        hqCommanderIds: exactPrevious.map((row) => row.commanderId),
        suggestions: buildSuggestions(lastRank.name, hqRows, claimed),
      });
      continue;
    }

    const fuzzyCurrent = fuzzyHits(
      lastRank.name,
      hqRows,
      claimed,
      "currentNames",
      fuzzyMin,
    );
    if (fuzzyCurrent.length === 1) {
      claimed.add(fuzzyCurrent[0].hq.commanderId);
      matched.push({
        status: "matched",
        lastRank,
        hq: fuzzyCurrent[0].hq,
        matchMethod: "fuzzy_current",
        fuzzyScore: fuzzyCurrent[0].score,
      });
      continue;
    }
    if (fuzzyCurrent.length > 1) {
      unmatched.push({
        status: "ambiguous",
        lastRank,
        hqCommanderIds: fuzzyCurrent.map((row) => row.hq.commanderId),
        suggestions: buildSuggestions(lastRank.name, hqRows, claimed),
      });
      continue;
    }

    const fuzzyPrevious = fuzzyHits(
      lastRank.name,
      hqRows,
      claimed,
      "previousNames",
      fuzzyMin,
    );
    if (fuzzyPrevious.length === 1) {
      claimed.add(fuzzyPrevious[0].hq.commanderId);
      matched.push({
        status: "matched",
        lastRank,
        hq: fuzzyPrevious[0].hq,
        matchMethod: "fuzzy_previous",
        fuzzyScore: fuzzyPrevious[0].score,
      });
      continue;
    }
    if (fuzzyPrevious.length > 1) {
      unmatched.push({
        status: "ambiguous",
        lastRank,
        hqCommanderIds: fuzzyPrevious.map((row) => row.hq.commanderId),
        suggestions: buildSuggestions(lastRank.name, hqRows, claimed),
      });
      continue;
    }

    unmatched.push({
      status: "unmatched",
      lastRank,
      hqCommanderIds: [],
      suggestions: buildSuggestions(lastRank.name, hqRows, claimed),
    });
  }

  return {
    matched,
    unmatched,
    unmatchedHq: hqRows.filter((row) => !claimed.has(row.commanderId)),
  };
}

/**
 * Resolve an operator-typed HQ name against remaining roster rows.
 * Prefers exact current, then exact previous (same uniqueness rules).
 */
export function resolveHqNameToRosterRow(
  hqName: string,
  hqRows: LastRankHqRosterRow[],
  claimedCommanderIds: Set<string>,
):
  | { ok: true; hq: LastRankHqRosterRow }
  | { ok: false; reason: "empty" | "unmatched" | "ambiguous"; hqCommanderIds: string[] } {
  const trimmed = hqName.trim();
  if (!trimmed) {
    return { ok: false, reason: "empty", hqCommanderIds: [] };
  }
  const current = exactHits(trimmed, hqRows, claimedCommanderIds, "currentNames");
  if (current.length === 1) return { ok: true, hq: current[0] };
  if (current.length > 1) {
    return {
      ok: false,
      reason: "ambiguous",
      hqCommanderIds: current.map((row) => row.commanderId),
    };
  }
  const previous = exactHits(
    trimmed,
    hqRows,
    claimedCommanderIds,
    "previousNames",
  );
  if (previous.length === 1) return { ok: true, hq: previous[0] };
  if (previous.length > 1) {
    return {
      ok: false,
      reason: "ambiguous",
      hqCommanderIds: previous.map((row) => row.commanderId),
    };
  }
  return { ok: false, reason: "unmatched", hqCommanderIds: [] };
}

export type LastRankInteractiveChoice = {
  name: string;
  score: number | null;
};

/** Numbered menu for `--interactive`: fuzzy suggestions, then other unmatched HQ. */
export function buildInteractiveHqChoices(input: {
  suggestions: LastRankUnmatchedRow["suggestions"];
  remainingHqNames: string[];
  maxSuggestions?: number;
}): LastRankInteractiveChoice[] {
  const maxSuggestions = input.maxSuggestions ?? 8;
  const seen = new Set<string>();
  const choices: LastRankInteractiveChoice[] = [];

  for (const suggestion of input.suggestions.slice(0, maxSuggestions)) {
    const name = suggestion.name.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    choices.push({ name, score: suggestion.score });
  }

  for (const raw of input.remainingHqNames) {
    const name = raw.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    choices.push({ name, score: null });
  }

  return choices;
}

/**
 * Parse interactive CLI input: blank → skip, `c`/`C` → create member,
 * 1-based index → menu choice, otherwise typed HQ roster name.
 */
export type LastRankInteractiveAnswer =
  | { kind: "skip" }
  | { kind: "create" }
  | { kind: "match"; hqName: string };

export function resolveInteractiveHqNameAnswer(
  answer: string,
  choices: LastRankInteractiveChoice[],
): LastRankInteractiveAnswer {
  const trimmed = answer.trim();
  if (!trimmed) return { kind: "skip" };
  if (/^c$/i.test(trimmed)) return { kind: "create" };
  if (/^\d+$/.test(trimmed)) {
    const index = Number.parseInt(trimmed, 10);
    if (index >= 1 && index <= choices.length) {
      return { kind: "match", hqName: choices[index - 1]!.name };
    }
  }
  return { kind: "match", hqName: trimmed };
}

export function applyInteractiveMatches(
  match: LastRankMatchResult,
  resolutions: Array<{
    lastRankPublicId: number;
    hq: LastRankHqRosterRow;
  }>,
): LastRankMatchResult {
  const byPublicId = new Map(
    resolutions.map((row) => [row.lastRankPublicId, row.hq]),
  );
  const claimed = new Set(match.matched.map((row) => row.hq.commanderId));
  const matched = [...match.matched];
  const stillUnmatched: LastRankUnmatchedRow[] = [];

  for (const row of match.unmatched) {
    const hq = byPublicId.get(row.lastRank.publicId);
    if (!hq || claimed.has(hq.commanderId)) {
      stillUnmatched.push(row);
      continue;
    }
    claimed.add(hq.commanderId);
    matched.push({
      status: "matched",
      lastRank: row.lastRank,
      hq,
      matchMethod: "interactive",
      fuzzyScore: null,
    });
  }

  const matchedIds = new Set(matched.map((row) => row.hq.commanderId));
  const allHq = [
    ...match.matched.map((row) => row.hq),
    ...match.unmatchedHq,
  ];
  const byId = new Map(allHq.map((row) => [row.commanderId, row]));
  for (const row of resolutions) {
    byId.set(row.hq.commanderId, row.hq);
  }

  return {
    matched,
    unmatched: stillUnmatched,
    unmatchedHq: [...byId.values()].filter((row) => !matchedIds.has(row.commanderId)),
  };
}

export function parseLastRankSyncMap(
  raw: string | undefined,
): Array<{ tag: string; lastrankAllianceId: string }> {
  if (!raw?.trim()) return [];
  const out: Array<{ tag: string; lastrankAllianceId: string }> = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      throw new Error(
        `Invalid LASTRANK_SYNC_MAP entry "${trimmed}" (expected TAG=32charHex)`,
      );
    }
    const tag = trimmed.slice(0, eq).trim();
    const lastrankAllianceId = trimmed.slice(eq + 1).trim().toLowerCase();
    if (!tag || !isLastRankAllianceId(lastrankAllianceId)) {
      throw new Error(
        `Invalid LASTRANK_SYNC_MAP entry "${trimmed}" (expected TAG=32charHex)`,
      );
    }
    out.push({ tag, lastrankAllianceId });
  }
  return out;
}
