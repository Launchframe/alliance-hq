import { normalizeCommanderName } from "@/lib/members/commander-identity-conflicts.shared";
import { stringSimilarity } from "@/lib/video/member-matcher";

import {
  LASTRANK_FUZZY_MATCH_MIN,
  lastRankPlayerProfileUrl,
  type LastRankAllianceMember,
} from "@/lib/lastrank/alliance-page.shared";

/** Trailing power / notes from officer paste lists (Telegram, sheets, etc.). */
const POWER_TAIL_RE =
  /\s*[-–—]\s*\d+(?:\.\d+)?\s*[Mm]\.?\s*(?:\([^)]*\))?\s*\.?\s*$/u;

/** Glued forms like `Akatsuki-164m` (no spaces around the hyphen). */
const POWER_TAIL_GLUED_RE = /[-–—]\d+(?:\.\d+)?[Mm]\.?\s*(?:\([^)]*\))?\s*\.?\s*$/u;

const TRAILING_NOTES_RE = /\s*\([^)]*\)\s*\.?\s*$/u;
const TRAILING_DOT_RE = /\.+\s*$/u;

export type PastePowerListLine = {
  raw: string;
  /** Extracted commander name, or null when the line is blank / not a name. */
  name: string | null;
};

export type PasteToLastRankMatchMethod = "exact" | "fuzzy";

export type PasteToLastRankMatched = {
  status: "matched";
  pasteName: string;
  lastRank: LastRankAllianceMember;
  matchMethod: PasteToLastRankMatchMethod;
  fuzzyScore: number | null;
  profileUrl: string;
};

export type PasteToLastRankUnmatched = {
  status: "unmatched" | "ambiguous";
  pasteName: string;
  suggestions: Array<{ name: string; publicId: number; score: number }>;
};

export type PasteToLastRankResult = {
  matched: PasteToLastRankMatched[];
  unmatched: PasteToLastRankUnmatched[];
};

/**
 * Strip power / parenthetical notes from one paste line.
 * Returns null for blank lines after trim.
 */
export function extractNameFromPowerPasteLine(rawLine: string): string | null {
  let line = rawLine.trim();
  if (!line) return null;

  line = line.replace(POWER_TAIL_RE, "").trim();
  line = line.replace(POWER_TAIL_GLUED_RE, "").trim();
  line = line.replace(TRAILING_NOTES_RE, "").trim();
  line = line.replace(TRAILING_DOT_RE, "").trim();

  return line || null;
}

export function parsePastePowerList(text: string): PastePowerListLine[] {
  return text.split(/\r?\n/).map((raw) => ({
    raw,
    name: extractNameFromPowerPasteLine(raw),
  }));
}

export function pasteNamesFromPowerList(text: string): string[] {
  const names: string[] = [];
  for (const row of parsePastePowerList(text)) {
    if (row.name) names.push(row.name);
  }
  return names;
}

function suggestionsForPaste(
  pasteName: string,
  members: LastRankAllianceMember[],
  claimed: Set<number>,
  limit = 5,
): PasteToLastRankUnmatched["suggestions"] {
  const scored: PasteToLastRankUnmatched["suggestions"] = [];
  for (const member of members) {
    if (claimed.has(member.publicId)) continue;
    const score = stringSimilarity(pasteName, member.name);
    scored.push({
      name: member.name,
      publicId: member.publicId,
      score,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * Match pasted officer names to a LastRank alliance roster (exact, then unique fuzzy).
 * Each LastRank member is claimed at most once (first paste wins).
 */
export function matchPasteNamesToLastRankMembers(
  pasteNames: string[],
  members: LastRankAllianceMember[],
  options?: { fuzzyMinScore?: number },
): PasteToLastRankResult {
  const fuzzyMin = options?.fuzzyMinScore ?? LASTRANK_FUZZY_MATCH_MIN;
  const claimed = new Set<number>();
  const matched: PasteToLastRankMatched[] = [];
  const unmatched: PasteToLastRankUnmatched[] = [];

  for (const pasteName of pasteNames) {
    const key = normalizeCommanderName(pasteName);
    if (!key) {
      unmatched.push({
        status: "unmatched",
        pasteName,
        suggestions: [],
      });
      continue;
    }

    const exactHits = members.filter(
      (m) =>
        !claimed.has(m.publicId) &&
        normalizeCommanderName(m.name) === key,
    );
    if (exactHits.length === 1) {
      claimed.add(exactHits[0].publicId);
      matched.push({
        status: "matched",
        pasteName,
        lastRank: exactHits[0],
        matchMethod: "exact",
        fuzzyScore: null,
        profileUrl: lastRankPlayerProfileUrl(exactHits[0].publicId),
      });
      continue;
    }
    if (exactHits.length > 1) {
      unmatched.push({
        status: "ambiguous",
        pasteName,
        suggestions: exactHits.map((m) => ({
          name: m.name,
          publicId: m.publicId,
          score: 1,
        })),
      });
      continue;
    }

    const fuzzyHits: Array<{
      member: LastRankAllianceMember;
      score: number;
    }> = [];
    for (const member of members) {
      if (claimed.has(member.publicId)) continue;
      const score = stringSimilarity(pasteName, member.name);
      if (score >= fuzzyMin) {
        fuzzyHits.push({ member, score });
      }
    }
    fuzzyHits.sort((a, b) => b.score - a.score);

    if (fuzzyHits.length === 1) {
      claimed.add(fuzzyHits[0].member.publicId);
      matched.push({
        status: "matched",
        pasteName,
        lastRank: fuzzyHits[0].member,
        matchMethod: "fuzzy",
        fuzzyScore: fuzzyHits[0].score,
        profileUrl: lastRankPlayerProfileUrl(fuzzyHits[0].member.publicId),
      });
      continue;
    }
    if (fuzzyHits.length > 1) {
      unmatched.push({
        status: "ambiguous",
        pasteName,
        suggestions: fuzzyHits.slice(0, 5).map((row) => ({
          name: row.member.name,
          publicId: row.member.publicId,
          score: row.score,
        })),
      });
      continue;
    }

    unmatched.push({
      status: "unmatched",
      pasteName,
      suggestions: suggestionsForPaste(pasteName, members, claimed),
    });
  }

  return { matched, unmatched };
}

export function formatPasteProfileLinksMarkdown(input: {
  tag: string;
  gameServerNumber: number;
  allianceName?: string | null;
  matched: PasteToLastRankMatched[];
}): string {
  const titleBase = input.allianceName?.trim()
    ? `${input.allianceName.trim()} (${input.tag})`
    : input.tag;
  const lines = [
    `# ${titleBase} — S${input.gameServerNumber} LastRank profiles`,
    ...input.matched.map(
      (row) => `- [${row.lastRank.name}](${row.profileUrl})`,
    ),
  ];
  return `${lines.join("\n")}\n`;
}
