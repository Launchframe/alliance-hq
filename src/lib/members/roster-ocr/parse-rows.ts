/**
 * Row-level parsing for individual OCR lines extracted from roster screenshots.
 *
 * Each member row may contain:
 *   - Member name (free text)
 *   - Hero Power: "X.XM" or "XM" format, e.g. "4.2M", "12M"
 *   - Member level: "Lv.N" or "Lv N", e.g. "Lv.85", "Lv 100"
 *
 * Names are everything that isn't a power/level token.
 */

import {
  cropTextLinesBelowSearch,
  SEARCH_FOR_MEMBERS_RE,
} from "@/lib/members/roster-ocr/crop-list-region.shared";
import type { AllianceRank, ParsedRosterRow, RosterLayout } from "@/lib/members/roster-ocr/types";
import {
  detectLayout,
  detectLastRankFromLines,
  detectTitle,
  isIgnoredLine,
  isOfficerTitleChrome,
  parseRankHeader,
  segmentByRankHeaders,
  stripOfficerTitles,
} from "@/lib/members/roster-ocr/segment-ranks";

// ---------------------------------------------------------------------------
// Regexes for stat tokens
// ---------------------------------------------------------------------------

/** Hero power in millions: "4.2M", "4M", "12.5M" */
const POWER_RE = /(\d+(?:\.\d+)?)\s*M\b/i;

/** Member level: "Lv.85", "Lv 100", "Lv85" */
const LEVEL_RE = /\bLv\.?\s*(\d+)\b/i;

/** Leading rank badge glued onto the R5 card / list name (`R5|`, `RS)`, …). */
const RANK_BADGE_PREFIX_RE =
  /^\s*R\s*(?:[Ss]|[1-5])\s*[|)\],.:]?\s*/i;

/** Trailing last-online noise glued onto names. */
const TRAILING_LAST_ONLINE_RE =
  /\s+(?:\d+\s*[mhd]?|[mhd]|id)\s*ago\b.*$/i;

const TRAILING_ONLINE_RE = /\s+online\b.*$/i;

const POWER_LABEL_RE = /^\s*power\s*[:}]?\s*/i;

// ---------------------------------------------------------------------------
// Single-line parser
// ---------------------------------------------------------------------------

export type ParsedLineTokens = {
  extractedName: string;
  heroPowerM?: number;
  memberLevel?: number;
  /** Rank inferred from a leading `R5|` / `RS|` badge, when present. */
  rankHint?: AllianceRank;
};

export type CleanedMemberName = {
  name: string;
  rankHint?: AllianceRank;
};

/**
 * Strip rank badges, last-online timestamps, and Power: labels from OCR text.
 */
export function cleanMemberName(raw: string): CleanedMemberName {
  let name = raw.replace(/\s+/g, " ").trim();
  let rankHint: AllianceRank | undefined;

  const badge = RANK_BADGE_PREFIX_RE.exec(name);
  if (badge) {
    const token = badge[0]!;
    if (/R\s*[Ss5]/i.test(token)) {
      rankHint = 5;
    } else {
      const digit = /[1-4]/.exec(token);
      if (digit) rankHint = Number(digit[0]) as AllianceRank;
    }
    name = name.slice(badge[0]!.length).trim();
  }

  name = name.replace(TRAILING_LAST_ONLINE_RE, "").trim();
  name = name.replace(TRAILING_ONLINE_RE, "").trim();
  name = name.replace(POWER_LABEL_RE, "").trim();
  // Drop gender icons, @ prefixes, and other OCR glue before/after the username.
  name = name.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").trim();

  return { name, rankHint };
}

/**
 * Extract name, power, and level tokens from a single OCR text line.
 *
 * The name is whatever remains after removing matched stat tokens.
 */
export function parseLineTokens(line: string): ParsedLineTokens {
  let remainder = line;

  let heroPowerM: number | undefined;
  const powerMatch = POWER_RE.exec(remainder);
  if (powerMatch) {
    heroPowerM = parseFloat(powerMatch[1]!);
    remainder = remainder.replace(powerMatch[0]!, " ");
  }

  let memberLevel: number | undefined;
  const levelMatch = LEVEL_RE.exec(remainder);
  if (levelMatch) {
    memberLevel = parseInt(levelMatch[1]!, 10);
    remainder = remainder.replace(levelMatch[0]!, " ");
  }

  const cleaned = cleanMemberName(remainder);
  return {
    extractedName: cleaned.name,
    heroPowerM,
    memberLevel,
    rankHint: cleaned.rankHint,
  };
}

export function isPlausibleMemberName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 2) return false;
  // Mostly punctuation / digits / symbols — not a commander name.
  const alnum = trimmed.replace(/[^\p{L}\p{N}]/gu, "");
  if (alnum.length < 2) return false;
  if (/^power$/i.test(trimmed)) return false;
  return true;
}

export function isStatsOnlyLine(line: string): boolean {
  const tokens = parseLineTokens(line);
  const hasStats =
    tokens.heroPowerM != null || tokens.memberLevel != null;
  if (!hasStats) return false;
  return !isPlausibleMemberName(tokens.extractedName);
}

// ---------------------------------------------------------------------------
// rank_list layout parsing
// ---------------------------------------------------------------------------

function prepareRankListSourceLines(lines: string[]): string[] {
  // Crop when Search is still present (callers may already have cropped).
  if (lines.some((line) => SEARCH_FOR_MEMBERS_RE.test(line))) {
    return cropTextLinesBelowSearch(lines).lines.map((l) => l.text);
  }
  return lines;
}

/**
 * Parse member rows from a rank-list layout (collapsible R1–R5 section headers).
 */
export function parseRankListRows(
  lines: string[],
  options?: { stickyRank?: AllianceRank },
): ParsedRosterRow[] {
  const source = prepareRankListSourceLines(lines);
  const stickyRank = options?.stickyRank;
  const segmented = segmentByRankHeaders(source, stickyRank);
  const rows: ParsedRosterRow[] = [];
  let pending: ParsedRosterRow | null = null;

  const flushPending = () => {
    if (pending && isPlausibleMemberName(pending.extractedName)) {
      rows.push(pending);
    }
    pending = null;
  };

  for (const { line, rank, isHeader } of segmented) {
    if (isHeader) {
      flushPending();
      continue;
    }
    if (isOfficerTitleChrome(line)) continue;

    // Members-page list: strip title tokens; never assign allianceRankTitle.
    const withoutTitles = stripOfficerTitles(line);
    if (!withoutTitles || isOfficerTitleChrome(withoutTitles)) {
      continue;
    }

    if (isStatsOnlyLine(withoutTitles)) {
      const stats = parseLineTokens(withoutTitles);
      if (pending) {
        if (pending.heroPowerM == null && stats.heroPowerM != null) {
          pending.heroPowerM = stats.heroPowerM;
        }
        if (pending.memberLevel == null && stats.memberLevel != null) {
          pending.memberLevel = stats.memberLevel;
        }
      }
      continue;
    }

    const effectiveRank = rank ?? stickyRank ?? null;
    const { rankHint } = parseLineTokens(withoutTitles);

    if (!effectiveRank && !rankHint) {
      // No section context and no badge hint — skip.
      continue;
    }

    const { extractedName, heroPowerM, memberLevel } =
      parseLineTokens(withoutTitles);
    if (!isPlausibleMemberName(extractedName)) continue;

    const allianceRank = (effectiveRank ?? rankHint) as AllianceRank | undefined;
    if (!allianceRank) continue;

    flushPending();
    pending = {
      extractedName,
      allianceRank,
      heroPowerM,
      memberLevel,
      layout: "rank_list",
    };
  }

  flushPending();
  return rows;
}

// ---------------------------------------------------------------------------
// officers layout parsing
// ---------------------------------------------------------------------------

/**
 * Parse member rows from the officers titled layout.
 *
 * On this screen:
 *   - "Leader" / R5 typically appears at the top as a standalone card.
 *   - R4 titled members (Warlord, Recruiter, Muse, Butler) appear below.
 *   - Members without a title token default to R4.
 */
export function parseOfficersRows(lines: string[]): ParsedRosterRow[] {
  const rows: ParsedRosterRow[] = [];

  for (const line of lines) {
    if (isIgnoredLine(line)) continue;
    if (parseRankHeader(line) !== null) continue;
    if (isOfficerTitleChrome(line)) continue;

    const titleMatch = detectTitle(line);

    if (titleMatch) {
      const { extractedName, heroPowerM, memberLevel } = parseLineTokens(
        titleMatch.remainder,
      );
      if (!isPlausibleMemberName(extractedName)) continue;

      rows.push({
        extractedName,
        allianceRank: titleMatch.rank as AllianceRank,
        allianceRankTitle: titleMatch.title,
        heroPowerM,
        memberLevel,
        layout: "officers",
      });
    } else {
      if (isStatsOnlyLine(line)) continue;
      const { extractedName, heroPowerM, memberLevel, rankHint } =
        parseLineTokens(line);
      if (!isPlausibleMemberName(extractedName)) continue;

      rows.push({
        extractedName,
        allianceRank: (rankHint ?? 4) as AllianceRank,
        heroPowerM,
        memberLevel,
        layout: "officers",
      });
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Unified entry point
// ---------------------------------------------------------------------------

export type ParseRosterRowsOptions = {
  forceRankList?: boolean;
  /** Carry rank context from a prior video frame when the header scrolled off. */
  stickyRank?: AllianceRank;
};

export type ParseRosterRowsResult = {
  rows: ParsedRosterRow[];
  layout: RosterLayout;
  /** Last rank section seen in these lines (for cross-frame sticky context). */
  lastRank: AllianceRank | null;
};

/**
 * Parse all rows from OCR lines, detecting the layout automatically.
 *
 * When `forceRankList` is set (Search crop found), officers layout is never used.
 */
export function parseRosterRows(
  lines: string[],
  explicitLayout?: RosterLayout,
  options?: ParseRosterRowsOptions,
): ParseRosterRowsResult {
  const layout =
    explicitLayout ??
    (options?.forceRankList ? "rank_list" : detectLayout(lines));

  const rows =
    layout === "officers"
      ? parseOfficersRows(lines)
      : parseRankListRows(lines, { stickyRank: options?.stickyRank });

  return {
    rows,
    layout,
    lastRank: detectLastRankFromLines(lines) ?? options?.stickyRank ?? null,
  };
}
