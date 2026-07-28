/**
 * Rank segmentation heuristics for roster screenshots.
 *
 * Two layouts:
 *
 * 1. 'rank_list' — collapsible rank list with R1–R5 section headers.
 *    The header sets the "current rank context" for subsequent member rows
 *    until the next header is found.
 *
 * 2. 'officers' — titled officers page.
 *    R5 (Leader) appears once at the top center.
 *    R4 members appear with named titles: Warlord, Recruiter, Muse, Butler.
 *
 * Both layouts must ignore UI chrome lines:
 *   "Search for Members", "Manage", "Online", timestamps ("Xm ago"), etc.
 */

import { SEARCH_FOR_MEMBERS_RE } from "@/lib/members/roster-ocr/crop-list-region.shared";
import type { AllianceRank, RosterLayout } from "@/lib/members/roster-ocr/types";

// ---------------------------------------------------------------------------
// Rank header detection
// ---------------------------------------------------------------------------

/** Bare `R3` or section headers with quota counts like `R3 9/78`. */
const RANK_HEADER_RE = /^\s*R\s*([1-5])(?:\s+\d+\s*\/\s*\d+)?\s*$/i;

/** Member quota on rank group headers, e.g. `7/83`. */
export const MEMBER_QUOTA_RE = /\d+\s*\/\s*\d+/;

/** Badge + custom group title + quota on one line. */
const COMBINED_RANK_GROUP_HEADER_RE =
  /^\s*R\s*([1-5])\s+(.+?)\s+\d+\s*\/\s*\d+/i;

/** Member stat tokens — absent on section header bars. */
const MEMBER_STATS_RE = /\bpower\s*[:}]?|\d+(?:\.\d+)?\s*M\b|\bLv\.?\s*\d+/i;

/** Bare rank badge only (`R3`), not `R3 Something`. */
const BARE_RANK_BADGE_RE = /^\s*R\s*([1-5])\s*$/i;

/** R5 titled roles and their canonical titles. */
const R5_TITLES: string[] = ["Leader"];

/** R4 titled roles. */
const R4_TITLES: string[] = ["Warlord", "Recruiter", "Muse", "Butler"];

/** All titled roles (any rank). Keyed lowercase → canonical. */
const TITLED_ROLE_MAP: Map<string, { title: string; rank: AllianceRank }> =
  new Map([
    ["leader", { title: "Leader", rank: 5 }],
    ["warlord", { title: "Warlord", rank: 4 }],
    ["recruiter", { title: "Recruiter", rank: 4 }],
    ["muse", { title: "Muse", rank: 4 }],
    ["butler", { title: "Butler", rank: 4 }],
  ]);

const OFFICER_TITLE_ALT = "Warlord|Recruiter|Muse|Butler|Leader";

/** Header chrome that is only officer title labels (often OCR-garbled). */
const OFFICER_TITLE_CHROME_RE = new RegExp(
  `^\\s*(?:${OFFICER_TITLE_ALT})(?:[\\s,./|\\]\\[)(]+(?:${OFFICER_TITLE_ALT})?)*\\s*$`,
  "i",
);

// ---------------------------------------------------------------------------
// Noise / UI chrome detection
// ---------------------------------------------------------------------------

const IGNORED_PATTERNS: RegExp[] = [
  SEARCH_FOR_MEMBERS_RE,
  /^\s*manage\s*$/i,
  /^\s*online\s*$/i,
  /^\s*\d+\s*[mhd]\s+ago\s*$/i, // whole-line timestamps only
  /^\s*[mhd]\s+ago\s*$/i,
  /^\s*id\s*ago\s*$/i,
  /^\s*members\s*$/i,
  /^\s*alliance\s*$/i,
  /^\s*rank\s*$/i,
  /^\s*\d+\s*\/\s*\d+\s*$/, // "45/100" member count
  /^\s*[<>v]\s*$/i,
  /^\s*timeout\b/i,
  OFFICER_TITLE_CHROME_RE,
];

export function isIgnoredLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  return IGNORED_PATTERNS.some((re) => re.test(trimmed));
}

export function isOfficerTitleChrome(line: string): boolean {
  return OFFICER_TITLE_CHROME_RE.test(line.trim());
}

// ---------------------------------------------------------------------------
// Rank header detection
// ---------------------------------------------------------------------------

export function parseRankHeader(line: string): AllianceRank | null {
  const m = RANK_HEADER_RE.exec(line.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  if (n >= 1 && n <= 5) return n as AllianceRank;
  return null;
}

export function hasMemberStats(line: string): boolean {
  return MEMBER_STATS_RE.test(line);
}

export function hasQuotaPattern(line: string): boolean {
  return MEMBER_QUOTA_RE.test(line);
}

export function isBareRankBadge(line: string): boolean {
  return BARE_RANK_BADGE_RE.test(line.trim());
}

function looksLikeGroupTitleContinuation(line: string): boolean {
  const trimmed = line.trim();
  if (hasQuotaPattern(trimmed)) return true;
  if (/\([v<>]|[<>v]\s*$/i.test(trimmed)) return true;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 3) return true;
  if (trimmed.length > 20) return true;
  return false;
}

export type RankGroupHeader = {
  rank: AllianceRank;
  /** Alliance-custom group title when OCR captured it (diagnostics only). */
  groupTitle?: string;
};

export type RankGroupHeaderContext = {
  /** Previous non-ignored line was a bare `R3` badge. */
  afterRankBadge?: boolean;
  /** Previous non-ignored line was any rank group header. */
  afterRankGroupHeader?: boolean;
  /** Rank from the preceding bare badge line. */
  badgeRank?: AllianceRank;
  /** Current section rank from an earlier header in this frame. */
  currentRank?: AllianceRank | null;
};

/**
 * Detect collapsible rank-group section headers.
 *
 * Headers set rank context but must never become roster member rows. Custom
 * group titles (e.g. "Heart of the Alliance") vary per alliance — match on
 * structure (R-badge, quota, title continuation) not fixed strings.
 */
export function parseRankGroupHeader(
  line: string,
  ctx?: RankGroupHeaderContext,
): RankGroupHeader | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const bare = parseRankHeader(trimmed);
  if (bare !== null) {
    return { rank: bare };
  }

  if (!hasMemberStats(trimmed)) {
    const combined = COMBINED_RANK_GROUP_HEADER_RE.exec(trimmed);
    if (combined) {
      const rank = parseInt(combined[1]!, 10) as AllianceRank;
      const groupTitle = combined[2]!.replace(/\s*[<>v)\(].*$/i, "").trim();
      return {
        rank,
        groupTitle: groupTitle || undefined,
      };
    }

    if (hasQuotaPattern(trimmed)) {
      const rank = ctx?.badgeRank ?? ctx?.currentRank ?? null;
      if (rank != null) {
        const groupTitle = trimmed
          .replace(MEMBER_QUOTA_RE, "")
          .replace(/\s*[<>v)\(].*$/i, "")
          .trim();
        return {
          rank,
          groupTitle: groupTitle || undefined,
        };
      }
    }

    if (ctx?.afterRankBadge && ctx.badgeRank != null) {
      if (looksLikeGroupTitleContinuation(trimmed)) {
        const groupTitle = trimmed.replace(/\s*[<>v)\(].*$/i, "").trim();
        if (groupTitle && parseRankHeader(groupTitle) === null) {
          return { rank: ctx.badgeRank, groupTitle };
        }
      }
    }

    if (ctx?.afterRankGroupHeader && ctx.currentRank != null) {
      if (looksLikeGroupTitleContinuation(trimmed)) {
        const groupTitle = trimmed.replace(/\s*[<>v)\(].*$/i, "").trim();
        if (groupTitle && parseRankHeader(groupTitle) === null) {
          return { rank: ctx.currentRank, groupTitle };
        }
      }
    }
  }

  return null;
}

export function isRankGroupHeaderLine(
  line: string,
  ctx?: RankGroupHeaderContext,
): boolean {
  return parseRankGroupHeader(line, ctx) !== null;
}

/** Last rank section seen while walking lines (for cross-frame sticky context). */
export function detectLastRankFromLines(lines: string[]): AllianceRank | null {
  let currentRank: AllianceRank | null = null;
  let afterRankBadge = false;
  let afterRankGroupHeader = false;
  let badgeRank: AllianceRank | undefined;

  for (const line of lines) {
    if (isIgnoredLine(line)) continue;

    const header = parseRankGroupHeader(line, {
      afterRankBadge,
      afterRankGroupHeader,
      badgeRank,
      currentRank,
    });

    if (header) {
      currentRank = header.rank;
      afterRankBadge = isBareRankBadge(line);
      badgeRank = afterRankBadge ? header.rank : undefined;
      afterRankGroupHeader = true;
      continue;
    }

    afterRankBadge = false;
    badgeRank = undefined;
    afterRankGroupHeader = false;
  }

  return currentRank;
}

// ---------------------------------------------------------------------------
// Title detection
// ---------------------------------------------------------------------------

export type TitleMatch = {
  title: string;
  rank: AllianceRank;
  /** Remaining text after the title token is removed. */
  remainder: string;
};

/**
 * Detect if a line contains a titled role keyword.
 * Returns the matched title info + the remainder of the line.
 */
export function detectTitle(line: string): TitleMatch | null {
  const allTitles = [...R5_TITLES, ...R4_TITLES];
  for (const titleKey of allTitles) {
    const escaped = titleKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:^|\\s)(${escaped})(?:\\s|$)`, "i");
    const m = re.exec(line);
    if (m) {
      const meta = TITLED_ROLE_MAP.get(titleKey.toLowerCase());
      if (!meta) continue;
      const remainder = line.replace(m[0]!, " ").trim();
      return { title: meta.title, rank: meta.rank, remainder };
    }
  }
  return null;
}

/** Strip every leading/embedded officer title token (Members list path). */
export function stripOfficerTitles(line: string): string {
  let remainder = line;
  for (let i = 0; i < 8; i++) {
    const match = detectTitle(remainder);
    if (!match) break;
    remainder = match.remainder;
  }
  return remainder.trim();
}

// ---------------------------------------------------------------------------
// Layout detection
// ---------------------------------------------------------------------------

/**
 * Detect whether the OCR lines represent an 'officers' or 'rank_list' layout.
 *
 * Members page (Search for Members / R1–R5 section headers) is always rank_list
 * so header titles never force the officers default-R4 path.
 */
export function detectLayout(lines: string[]): RosterLayout {
  let rankHeaderCount = 0;
  let titleCount = 0;
  let hasSearch = false;

  for (const line of lines) {
    if (SEARCH_FOR_MEMBERS_RE.test(line)) hasSearch = true;
    if (parseRankHeader(line) !== null) rankHeaderCount++;
    if (detectTitle(line) !== null) titleCount++;
  }

  if (hasSearch) return "rank_list";
  if (rankHeaderCount >= 1) return "rank_list";
  if (titleCount >= 1) return "officers";
  return "rank_list";
}

// ---------------------------------------------------------------------------
// Segmented rank context (for rank_list layout)
// ---------------------------------------------------------------------------

export type LineWithRankContext = {
  line: string;
  rank: AllianceRank | null;
  /** True if this line is a rank section header (R1–R5 label). */
  isHeader: boolean;
};

/**
 * Walk OCR lines and assign a rank context to each member line based on the
 * nearest preceding R1–R5 header.
 */
export function segmentByRankHeaders(lines: string[]): LineWithRankContext[] {
  let currentRank: AllianceRank | null = null;
  const result: LineWithRankContext[] = [];
  let afterRankBadge = false;
  let afterRankGroupHeader = false;
  let badgeRank: AllianceRank | undefined;

  for (const line of lines) {
    if (isIgnoredLine(line)) continue;

    const header = parseRankGroupHeader(line, {
      afterRankBadge,
      afterRankGroupHeader,
      badgeRank,
      currentRank,
    });

    if (header) {
      currentRank = header.rank;
      afterRankBadge = isBareRankBadge(line);
      badgeRank = afterRankBadge ? header.rank : undefined;
      afterRankGroupHeader = true;
      result.push({ line, rank: header.rank, isHeader: true });
      continue;
    }

    afterRankBadge = false;
    badgeRank = undefined;
    afterRankGroupHeader = false;
    result.push({ line, rank: currentRank, isHeader: false });
  }

  return result;
}
