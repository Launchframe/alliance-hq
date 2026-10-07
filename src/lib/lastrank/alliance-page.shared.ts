import { normalizeCommanderName } from "@/lib/members/commander-identity-conflicts.shared";
import {
  MEMBER_FUZZY_AUTO_MATCH_MIN,
  stringSimilarity,
} from "@/lib/video/member-matcher";

export type LastRankProfession = "War Leader" | "Engineer";

/** LastRank's own catalog id — not a Last War game UID. */
export type LastRankAllianceMember = {
  publicId: number;
  name: string;
  country: string | null;
  power: number | null;
  heroPower: number | null;
  allianceRank: number | null;
  baseLevel: number | null;
  /** `null` when LastRank reports no profession (`career_type: 0`) or omits it. */
  profession: LastRankProfession | null;
  professionLevel: number | null;
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
  hqProfession: string | null;
  hqProfessionLevel: number | null;
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

/** Not in an R1–R5 section after HTML parse — often a recent leaver still on the page. */
export function isLastRankUnranked(
  member: Pick<LastRankAllianceMember, "allianceRank">,
): boolean {
  const rank = member.allianceRank;
  return (
    rank == null ||
    !Number.isInteger(rank) ||
    rank < 1 ||
    rank > 5
  );
}

/** Auto-create / interactive `C` only for ranked unmatched rows (skip leavers). */
export function lastRankMemberEligibleForCreate(
  lastRank: Pick<LastRankAllianceMember, "allianceRank">,
): boolean {
  return !isLastRankUnranked(lastRank);
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** LastRank RSC `career_type` codes (0 = no profession chosen). */
const LASTRANK_CAREER_TYPE_PROFESSION: Record<number, LastRankProfession> = {
  101: "Engineer",
  102: "War Leader",
};

function normalizeProfessionLevel(value: number | null): number | null {
  if (value == null || !Number.isFinite(value) || value < 1) return null;
  return Math.round(value);
}

function parseRawMember(raw: unknown): LastRankAllianceMember | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const publicId = asFiniteNumber(row.public_id);
  if (!name || publicId == null) return null;
  const careerType = asFiniteNumber(row.career_type);
  const profession =
    careerType != null
      ? (LASTRANK_CAREER_TYPE_PROFESSION[careerType] ?? null)
      : null;
  return {
    publicId: Math.round(publicId),
    name,
    country: typeof row.country === "string" ? row.country : null,
    power: asFiniteNumber(row.power),
    heroPower: asFiniteNumber(row.hero_power),
    allianceRank: asFiniteNumber(row.alliance_rank),
    baseLevel: asFiniteNumber(row.base_level),
    profession,
    professionLevel: profession
      ? normalizeProfessionLevel(asFiniteNumber(row.career_lv))
      : null,
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

/**
 * Fallback for the rendered Profession badge (`⚔ WL · Lv 100` / `🛠 ENG · Nv 30`).
 * The level abbreviation follows LastRank's locale (pt-BR renders "Nv"), so
 * accept either. The `·` prefix keeps the separate "HQ Lv" cell out of it.
 */
export function parseLastRankProfessionBadges(
  html: string,
): Map<number, { profession: LastRankProfession; professionLevel: number | null }> {
  const out = new Map<
    number,
    { profession: LastRankProfession; professionLevel: number | null }
  >();
  for (const rowMatch of html.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
    const row = rowMatch[0];
    const player = row.match(/href="\/p\/(\d+)"/);
    if (!player?.[1]) continue;
    const label =
      row.match(/<span\b[^>]*>\s*(WL|ENG)\s*<\/span>/)?.[1] ??
      row.match(/<span aria-hidden="true">\s*(⚔|🛠)\uFE0F?\s*<\/span>/u)?.[1];
    if (!label) continue;
    const profession: LastRankProfession =
      label === "WL" || label === "⚔" ? "War Leader" : "Engineer";
    const level = row.match(
      /·\s*(?:Lv|Nv)\.?\s*(?:<!--\s*-->\s*)?(\d+)/i,
    )?.[1];
    out.set(Number(player[1]), {
      profession,
      professionLevel: normalizeProfessionLevel(
        level != null ? Number(level) : null,
      ),
    });
  }
  return out;
}

export function applyProfessionBadgesToMembers(
  members: LastRankAllianceMember[],
  badges: ReturnType<typeof parseLastRankProfessionBadges>,
): LastRankAllianceMember[] {
  if (badges.size === 0) return members;
  return members.map((member) => {
    const badge = badges.get(member.publicId);
    if (!badge) return member;
    const profession = member.profession ?? badge.profession;
    const levelMatches = member.profession == null || member.profession === badge.profession;
    return {
      ...member,
      profession,
      professionLevel: member.professionLevel ?? (levelMatches ? badge.professionLevel : null),
    };
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
          members: applyProfessionBadgesToMembers(
            applySectionRanksToMembers(members, sectionRanks),
            parseLastRankProfessionBadges(html),
          ),
        };
      }
    } catch {
      // try the next flight chunk
    }
    from = jsonStart + 1;
  }

  throw new Error("LastRank HTML did not contain alliance member stats");
}

/**
 * An HQ profession change newer than this outranks LastRank, whose snapshot may
 * predate it. Older (or undated) HQ professions defer to LastRank.
 */
export const LASTRANK_PROFESSION_HQ_RECENT_DAYS = 7;

export type LastRankProfessionDecision = {
  /**
   * `apply`: HQ has none. `switch`: HQ differs but is stale — adopt LastRank.
   * `conflict`: HQ differs and changed recently — keep HQ.
   */
  profession: "apply" | "switch" | "unchanged" | "conflict" | "missing";
  level: "apply" | "unchanged" | "conflict" | "missing";
};

/**
 * `hqProfessionChangedAt` is the latest HQ profession change (null when unknown,
 * which counts as stale). After a switch the LastRank level replaces HQ's, since
 * the old level belongs to the other profession; otherwise the level never
 * regresses, and is not written while HQ keeps a different profession.
 */
export function decideLastRankProfessionApply(
  hq: Pick<LastRankHqRosterRow, "hqProfession" | "hqProfessionLevel">,
  lastRank: Pick<LastRankAllianceMember, "profession" | "professionLevel">,
  options: { hqProfessionChangedAt?: Date | null; now?: Date } = {},
): LastRankProfessionDecision {
  if (lastRank.profession == null) {
    return { profession: "missing", level: "missing" };
  }
  let profession: LastRankProfessionDecision["profession"];
  if (hq.hqProfession == null || hq.hqProfession === "") {
    profession = "apply";
  } else if (hq.hqProfession === lastRank.profession) {
    profession = "unchanged";
  } else {
    const changedAt = options.hqProfessionChangedAt;
    const now = options.now ?? new Date();
    const recentMs = LASTRANK_PROFESSION_HQ_RECENT_DAYS * 24 * 60 * 60 * 1000;
    profession =
      changedAt != null && now.getTime() - changedAt.getTime() < recentMs
        ? "conflict"
        : "switch";
  }

  const nextLevel = lastRank.professionLevel;
  let level: LastRankProfessionDecision["level"];
  if (profession === "conflict" || nextLevel == null) {
    level = "missing";
  } else if (profession === "switch") {
    level = nextLevel === hq.hqProfessionLevel ? "unchanged" : "apply";
  } else if (hq.hqProfessionLevel == null || nextLevel > hq.hqProfessionLevel) {
    level = "apply";
  } else if (nextLevel === hq.hqProfessionLevel) {
    level = "unchanged";
  } else {
    level = "conflict";
  }
  return { profession, level };
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
 * 1. sticky LastRank public id
 * 2. exact current names
 * 3. exact previous names
 * 4. fuzzy current / previous — **suggestions only** (never auto-match)
 *
 * Sole fuzzy hits (≥ {@link LASTRANK_FUZZY_MATCH_MIN}, default 0.6) used to
 * auto-match. That silently wrote alliance ranks (incl. R5) onto the wrong HQ
 * member on cron `--apply`, and hybrid owner invites trust that rank. Fuzzy
 * candidates stay unmatched with suggestions for `--interactive` confirm.
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
    // Never auto-match sole fuzzy hits — cron apply would stamp ranks/THP and
    // sticky public ids onto near-miss names (e.g. Mike↔Nike at 0.75).
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
