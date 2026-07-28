/**
 * Heuristics for detecting suspiciously low-quality roster video parses.
 */

import type { ParsedRosterRow } from "@/lib/members/roster-ocr/types";
import { hasQuotaPattern } from "@/lib/members/roster-ocr/segment-ranks";

export const ROSTER_LOW_QUALITY_ROW_THRESHOLD = 12;

export type RosterParseQuality = {
  lowQuality: boolean;
  reason?: "too_few_rows" | "header_like_rows";
};

/**
 * True when OCR output looks like section-header junk rather than real members.
 */
export function isLowQualityRosterParse(
  rows: ParsedRosterRow[],
  options?: { frameCount?: number },
): RosterParseQuality {
  if (rows.length === 0) {
    return { lowQuality: true, reason: "too_few_rows" };
  }

  const frameCount = options?.frameCount ?? 1;
  const minExpected = Math.min(
    ROSTER_LOW_QUALITY_ROW_THRESHOLD,
    Math.max(3, Math.floor(frameCount / 4)),
  );

  if (rows.length < minExpected) {
    const withStats = rows.filter(
      (r) => r.heroPowerM != null || r.memberLevel != null,
    );
    const headerLike = rows.filter(
      (r) =>
        (r.heroPowerM == null && r.memberLevel == null) ||
        hasQuotaPattern(r.extractedName),
    );

    if (withStats.length === 0 && headerLike.length === rows.length) {
      return { lowQuality: true, reason: "header_like_rows" };
    }

    if (rows.length <= 2 && withStats.length === 0) {
      return { lowQuality: true, reason: "too_few_rows" };
    }
  }

  return { lowQuality: false };
}

export const ROSTER_LOW_QUALITY_BANNER =
  "Few members detected — scroll slowly through the full list below Search for Members.";
