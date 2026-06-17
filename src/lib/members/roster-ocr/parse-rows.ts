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

import type { AllianceRank, ParsedRosterRow, RosterLayout } from "@/lib/members/roster-ocr/types";
import {
  detectTitle,
  isIgnoredLine,
  segmentByRankHeaders,
  detectLayout,
} from "@/lib/members/roster-ocr/segment-ranks";

// ---------------------------------------------------------------------------
// Regexes for stat tokens
// ---------------------------------------------------------------------------

/** Hero power in millions: "4.2M", "4M", "12.5M" */
const POWER_RE = /(\d+(?:\.\d+)?)\s*M\b/i;

/** Member level: "Lv.85", "Lv 100", "Lv85" */
const LEVEL_RE = /\bLv\.?\s*(\d+)\b/i;

// ---------------------------------------------------------------------------
// Single-line parser
// ---------------------------------------------------------------------------

export type ParsedLineTokens = {
  extractedName: string;
  heroPowerM?: number;
  memberLevel?: number;
};

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

  const extractedName = remainder.replace(/\s+/g, " ").trim();

  return { extractedName, heroPowerM, memberLevel };
}

// ---------------------------------------------------------------------------
// rank_list layout parsing
// ---------------------------------------------------------------------------

/**
 * Parse member rows from a rank-list layout (collapsible R1–R5 section headers).
 */
export function parseRankListRows(lines: string[]): ParsedRosterRow[] {
  const segmented = segmentByRankHeaders(lines);
  const rows: ParsedRosterRow[] = [];

  for (const { line, rank, isHeader } of segmented) {
    if (isHeader) continue;
    if (!rank) continue;

    const { extractedName, heroPowerM, memberLevel } = parseLineTokens(line);
    if (!extractedName || extractedName.length < 2) continue;

    rows.push({
      extractedName,
      allianceRank: rank,
      heroPowerM,
      memberLevel,
      layout: "rank_list",
    });
  }

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

    const titleMatch = detectTitle(line);

    if (titleMatch) {
      const { extractedName, heroPowerM, memberLevel } = parseLineTokens(
        titleMatch.remainder,
      );

      rows.push({
        extractedName: extractedName || "(untitled)",
        allianceRank: titleMatch.rank as AllianceRank,
        allianceRankTitle: titleMatch.title,
        heroPowerM,
        memberLevel,
        layout: "officers",
      });
    } else {
      // Lines without a title token: extract tokens and treat as R4 (officer default)
      const { extractedName, heroPowerM, memberLevel } = parseLineTokens(line);
      if (!extractedName || extractedName.length < 2) continue;

      rows.push({
        extractedName,
        allianceRank: 4,
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

/**
 * Parse all rows from OCR lines, detecting the layout automatically.
 */
export function parseRosterRows(
  lines: string[],
  explicitLayout?: RosterLayout,
): { rows: ParsedRosterRow[]; layout: RosterLayout } {
  const layout = explicitLayout ?? detectLayout(lines);

  const rows =
    layout === "officers"
      ? parseOfficersRows(lines)
      : parseRankListRows(lines);

  return { rows, layout };
}
