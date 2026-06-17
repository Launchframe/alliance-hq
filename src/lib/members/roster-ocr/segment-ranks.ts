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

import type { AllianceRank, RosterLayout } from "@/lib/members/roster-ocr/types";

// ---------------------------------------------------------------------------
// Rank header detection
// ---------------------------------------------------------------------------

const RANK_HEADER_RE = /^\s*R\s*([1-5])\s*$/i;

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

// ---------------------------------------------------------------------------
// Noise / UI chrome detection
// ---------------------------------------------------------------------------

const IGNORED_PATTERNS: RegExp[] = [
  /search\s+for\s+members/i,
  /\bmanage\b/i,
  /\bonline\b/i,
  /\d+\s*[mhd]\s+ago/i,      // "5m ago", "2h ago"
  /^\s*members\s*$/i,
  /^\s*alliance\s*$/i,
  /^\s*rank\s*$/i,
  /^\s*\d+\s*\/\s*\d+\s*$/,  // "45/100" member count
  /^\s*[<>]\s*$/,
];

export function isIgnoredLine(line: string): boolean {
  return IGNORED_PATTERNS.some((re) => re.test(line));
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

// ---------------------------------------------------------------------------
// Layout detection
// ---------------------------------------------------------------------------

/**
 * Detect whether the OCR lines represent an 'officers' or 'rank_list' layout.
 *
 * Officers layout: has at least one titled role keyword without R1–R5 headers.
 * Rank list layout: has R1–R5 collapsible header lines.
 */
export function detectLayout(lines: string[]): RosterLayout {
  let rankHeaderCount = 0;
  let titleCount = 0;

  for (const line of lines) {
    if (parseRankHeader(line) !== null) rankHeaderCount++;
    if (detectTitle(line) !== null) titleCount++;
  }

  if (rankHeaderCount >= 2) return "rank_list";
  if (titleCount >= 1) return "officers";
  // Fallback: if there's one rank header plus titles, treat as rank_list
  if (rankHeaderCount === 1) return "rank_list";
  return "rank_list"; // default
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

  for (const line of lines) {
    if (isIgnoredLine(line)) continue;

    const headerRank = parseRankHeader(line);
    if (headerRank !== null) {
      currentRank = headerRank;
      result.push({ line, rank: headerRank, isHeader: true });
      continue;
    }

    result.push({ line, rank: currentRank, isHeader: false });
  }

  return result;
}
