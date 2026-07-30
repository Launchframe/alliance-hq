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

/**
 * Structural rank-group header: `R#` shield badge + ANYTHING (or nothing) +
 * `online/total` member quota. Group titles are alliance-set free text
 * ("Timeout", "Heart of the Alliance", or blank) so the text between the
 * shield and the quota carries zero signal — only the badge and the quota do.
 *
 * The badge digit is a single character right after `R`, followed by a real
 * separator (whitespace or OCR punctuation from the shield edge) so member
 * names like "Rambo" or "Rat King" can never match. OCR frequently garbles
 * the digit itself ("Ra) Timeout 0/1" for an R1/R2 shield) — a quota-bearing
 * line with an unreadable badge digit is still definitely a header, just one
 * whose rank we can't trust.
 */
const SHIELD_QUOTA_HEADER_RE =
  /^[^A-Za-z0-9]{0,3}R\s*([0-9A-Za-z])(?:\s+|[|)\],.:]+\s*)(.*?)\s+[A-Za-z0-9]{1,3}\s*\/\s*\d+/i;

/** Map an OCR'd shield badge char to a rank; null when unreadable. */
function resolveRankBadgeChar(ch: string): AllianceRank | null {
  if (/^[1-5]$/.test(ch)) return parseInt(ch, 10) as AllianceRank;
  if (/^[Ss]$/.test(ch)) return 5; // "RS" — common OCR reading of the R5 shield
  return null;
}

/**
 * Infer rank from a quota numerator when OCR glues an extra leading digit
 * (e.g. "14/10" for an R4 section whose true quota is "4/10").
 */
export function inferRankFromQuotaNumerator(numerator: number): AllianceRank | null {
  if (numerator >= 1 && numerator <= 5) return numerator as AllianceRank;
  if (numerator >= 10 && numerator <= 59) {
    const lastDigit = numerator % 10;
    if (lastDigit >= 1 && lastDigit <= 5) return lastDigit as AllianceRank;
  }
  return null;
}

function normalizeGroupTitleForMatch(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when a scroll-transition line is a title-only continuation of the
 * current section header (badge/quota scrolled off, custom title remains).
 */
export function looksLikeKnownGroupTitleLine(
  line: string,
  knownTitle: string,
): boolean {
  const normTitle = normalizeGroupTitleForMatch(knownTitle);
  if (!normTitle || normTitle.length < 4) return false;

  const normLine = normalizeGroupTitleForMatch(stripGroupTitleGarbage(line));
  if (!normLine) return false;
  if (normLine === normTitle) return true;
  if (normLine.includes(normTitle) || normTitle.includes(normLine)) {
    return normLine.length >= normTitle.length * 0.4;
  }

  const titleTokens = normTitle.split(" ").filter((t) => t.length >= 3);
  if (titleTokens.length === 0) return false;
  const matched = titleTokens.filter((t) => normLine.includes(t)).length;
  return matched >= Math.ceil(titleTokens.length * 0.6);
}

/** Member stat tokens — absent on section header bars. */
const MEMBER_STATS_RE = /\bpower\s*[:}]?|\d+(?:\.\d+)?\s*M\b|\bLv\.?\s*\d+/i;

/** Bare rank badge only (`R3`), not `R3 Something`. */
const BARE_RANK_BADGE_RE = /^\s*R\s*([1-5])\s*$/i;

/**
 * Badge + arbitrary trailing text (title, quota, chevron garbage) glued onto
 * ONE line, with no quota required. Tolerates a few leading OCR-noise chars
 * (e.g. a stray "[" from an adjacent collapse icon) and requires a real
 * separator right after the digit — not another letter/digit — so real
 * usernames like "R3Ace" (no separator) still fall through to member parsing.
 */
const LOOSE_RANK_BADGE_LINE_RE =
  /^[^A-Za-z0-9]{0,3}R\s*([1-5])(?:\s+|[|)\]]+\s*)(.+)$/i;

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
  // Member rows often follow a header on the next line — never treat them as title continuations.
  if (/\bonline\b/i.test(trimmed)) return false;
  if (/\bago\b/i.test(trimmed)) return false;
  if (hasMemberStats(trimmed)) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 3) return true;
  if (trimmed.length > 20) return true;
  return false;
}

/**
 * Strip OCR collapse-chevron / pipe garbage from a captured group title.
 * Diagnostics only — must not truncate titles that contain the letter "v"
 * (e.g. "Vanguard") by treating every `v` as a chevron token.
 */
function stripGroupTitleGarbage(title: string): string {
  return title
    .replace(/\s*\([vw<>|)\]].*$/i, "")
    .replace(/\s*[|\]<>].*$/, "")
    .replace(/\s+\b(?:wv|v)\b\s*$/i, "")
    .trim();
}

export type RankGroupHeader = {
  /**
   * null when the line is structurally a header (shield badge + quota) but
   * OCR garbled the badge digit — the line must never become a member row,
   * yet it cannot establish a trustworthy rank context either.
   */
  rank: AllianceRank | null;
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
  /** Custom group title for the current sticky rank section. */
  currentGroupTitle?: string;
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
      const groupTitle = stripGroupTitleGarbage(combined[2]!);
      return {
        rank,
        groupTitle: groupTitle || undefined,
      };
    }

    // Shield badge + quota is conclusive header structure no matter what the
    // alliance-set title in between says (or whether the badge digit was
    // OCR'd correctly). NOT gated on the same-rank guard below: the same
    // section header legitimately re-appears across overlapping scroll
    // frames while its rank is already the sticky/current rank, and a member
    // row never carries an `online/total` quota.
    const shieldQuota = SHIELD_QUOTA_HEADER_RE.exec(trimmed);
    if (shieldQuota) {
      let rank = resolveRankBadgeChar(shieldQuota[1]!);
      if (rank == null) {
        const quotaInLine = /[A-Za-z0-9]{1,3}\s*\/\s*\d+/.exec(trimmed);
        if (quotaInLine) {
          const numerator = parseInt(
            quotaInLine[0]!.split("/")[0]!.trim(),
            10,
          );
          if (!Number.isNaN(numerator)) {
            rank = inferRankFromQuotaNumerator(numerator);
          }
        }
      }
      const groupTitle = stripGroupTitleGarbage(shieldQuota[2] ?? "");
      return {
        rank,
        groupTitle: groupTitle || undefined,
      };
    }

    // Same-line badge + title/garbage with NO quota — the most common
    // real-world OCR rendering ("R3 Heart of the Alliance (wv |", "R3) on M",
    // "[R4 Crowd Control 14/10 (|"). Quota is optional supporting evidence,
    // not a requirement: OCR frequently fails to capture the quota digits at
    // all even when the same alliance's other rank headers do show them.
    //
    // BUT: this pattern is structurally identical to a per-row rank badge
    // glued onto a member's name (e.g. "R5|BigLeader", "R3| Ace Ventura" —
    // the same OCR artifact `RANK_BADGE_PREFIX_RE` in parse-rows.ts strips
    // from member rows) whenever that member's Power/Lv stats land on a
    // separate line, so this line alone has no stats to disqualify it via
    // `hasMemberStats`. Once a rank section is already established, a
    // same-rank "R<n> ..." line is a member row, not a *new* header — real
    // headers only ever introduce a *different* rank than the one already
    // in effect. Only headers whose digit differs from the already-current
    // rank (or when no rank context exists yet) win this branch.
    const loose = LOOSE_RANK_BADGE_LINE_RE.exec(trimmed);
    if (loose) {
      const rank = parseInt(loose[1]!, 10) as AllianceRank;
      if (rank !== ctx?.currentRank) {
        const groupTitle = stripGroupTitleGarbage(
          loose[2]!.replace(MEMBER_QUOTA_RE, ""),
        );
        return {
          rank,
          groupTitle: groupTitle || undefined,
        };
      }
    }

    if (hasQuotaPattern(trimmed)) {
      const rank = ctx?.badgeRank ?? ctx?.currentRank ?? null;
      if (rank != null) {
        const groupTitle = stripGroupTitleGarbage(
          trimmed.replace(MEMBER_QUOTA_RE, ""),
        );
        return {
          rank,
          groupTitle: groupTitle || undefined,
        };
      }
    }

    if (ctx?.afterRankBadge && ctx.badgeRank != null) {
      if (looksLikeGroupTitleContinuation(trimmed)) {
        const groupTitle = stripGroupTitleGarbage(trimmed);
        if (groupTitle && parseRankHeader(groupTitle) === null) {
          return { rank: ctx.badgeRank, groupTitle };
        }
      }
    }

    if (ctx?.afterRankGroupHeader && ctx.currentRank != null) {
      if (looksLikeGroupTitleContinuation(trimmed)) {
        const groupTitle = stripGroupTitleGarbage(trimmed);
        if (groupTitle && parseRankHeader(groupTitle) === null) {
          return { rank: ctx.currentRank, groupTitle };
        }
      }
    }

    // Title-only continuation of the current section while scrolling (badge/quota
    // scrolled off-screen but the alliance-set custom title is still visible).
    if (
      ctx?.currentGroupTitle &&
      ctx.currentRank != null &&
      !/\bago\b/i.test(trimmed) &&
      !/^@/.test(trimmed) &&
      looksLikeKnownGroupTitleLine(trimmed, ctx.currentGroupTitle)
    ) {
      return {
        rank: ctx.currentRank,
        groupTitle: ctx.currentGroupTitle,
      };
    }

    // Badge scrolled off but quota digits remain (e.g. "(ry Crowd Control 14/10").
    const quotaOnlyMatch = MEMBER_QUOTA_RE.exec(trimmed);
    if (
      quotaOnlyMatch &&
      !/\bago\b/i.test(trimmed) &&
      !/^@/.test(trimmed)
    ) {
      const numerator = parseInt(quotaOnlyMatch[0]!.split("/")[0]!.trim(), 10);
      const inferredRank = inferRankFromQuotaNumerator(numerator);
      if (inferredRank != null && inferredRank !== ctx?.currentRank) {
        const groupTitle = stripGroupTitleGarbage(
          trimmed
            .slice(0, quotaOnlyMatch.index)
            .replace(/^[^A-Za-z0-9]{0,5}\(?\s*[A-Za-z]{0,3}\s*/, ""),
        );
        return {
          rank: inferredRank,
          groupTitle: groupTitle || undefined,
        };
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
      if (header.rank != null) {
        currentRank = header.rank;
      }
      afterRankBadge = isBareRankBadge(line);
      badgeRank = afterRankBadge ? (header.rank ?? undefined) : undefined;
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
 *
 * `initialRank` seeds the context with a sticky rank carried over from a
 * prior video frame (e.g. the header scrolled off-screen). This lets the
 * same-rank guard in `parseRankGroupHeader` correctly treat a badge-prefixed
 * member row as the very first line of a frame, instead of mistaking it for
 * a brand-new section header.
 */
export function segmentByRankHeaders(
  lines: string[],
  initialRank?: AllianceRank | null,
): LineWithRankContext[] {
  let currentRank: AllianceRank | null = initialRank ?? null;
  let currentGroupTitle: string | undefined;
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
      currentGroupTitle,
    });

    if (header) {
      const previousRank = currentRank;
      if (header.rank != null) {
        currentRank = header.rank;
      }
      if (header.groupTitle) {
        currentGroupTitle = header.groupTitle;
      } else if (header.rank != null && header.rank !== previousRank) {
        currentGroupTitle = undefined;
      }
      afterRankBadge = isBareRankBadge(line);
      badgeRank = afterRankBadge ? (header.rank ?? undefined) : undefined;
      afterRankGroupHeader = true;
      result.push({ line, rank: header.rank, isHeader: true });
      continue;
    }

    afterRankBadge = false;
    badgeRank = undefined;
    afterRankGroupHeader = false;
    result.push({ line, rank: currentRank, isHeader: false });
  }

  if (initialRank == null) {
    applyPreHeaderRankInference(result);
  }

  return result;
}

/**
 * Members listed above the first readable rank header belong to the next-higher
 * rank section (e.g. R4 members appear before the first R3 header when
 * scrolling top-down through the Members list).
 */
function applyPreHeaderRankInference(result: LineWithRankContext[]): void {
  const firstRankIdx = result.findIndex((r) => r.isHeader && r.rank != null);
  if (firstRankIdx <= 0) return;

  const firstRank = result[firstRankIdx]!.rank!;
  if (firstRank >= 5) return;

  const inferredPreRank = (firstRank + 1) as AllianceRank;
  for (let i = 0; i < firstRankIdx; i++) {
    const row = result[i]!;
    if (!row.isHeader && row.rank == null) {
      row.rank = inferredPreRank;
    }
  }
}
