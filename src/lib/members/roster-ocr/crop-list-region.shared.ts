/**
 * Restrict roster OCR to the scrollable member list below "Search for Members".
 *
 * The Members page header (R5 card + Warlord/Recruiter/Muse/Butler) repeats on
 * every frame and must not become roster rows.
 */

import type { ExtractedOcrLine } from "@/lib/members/roster-ocr/tesseract-lines.shared";

export const SEARCH_FOR_MEMBERS_RE = /search\s+for\s+members/i;

export type RosterOcrLineLike = {
  text: string;
  bbox?: { y0: number; y1: number } | null;
};

export type CropListRegionResult<T extends RosterOcrLineLike> = {
  lines: T[];
  /** True when a Search marker was found and lines above it were dropped. */
  croppedBelowSearch: boolean;
};

function isSearchLine(text: string): boolean {
  return SEARCH_FOR_MEMBERS_RE.test(text);
}

/**
 * Keep only OCR lines that sit below the Search bar.
 *
 * Prefers line bbox geometry when available; falls back to dropping every
 * line up to and including the first Search text match.
 */
export function cropRosterLinesBelowSearch<T extends RosterOcrLineLike>(
  lines: T[],
  options?: { padPx?: number },
): CropListRegionResult<T> {
  const padPx = options?.padPx ?? 4;

  const searchWithBbox = lines.find(
    (line) =>
      isSearchLine(line.text) &&
      line.bbox != null &&
      Number.isFinite(line.bbox.y1),
  );

  if (searchWithBbox?.bbox) {
    const cutoff = searchWithBbox.bbox.y1 + padPx;
    const searchIndex = lines.indexOf(searchWithBbox);
    return {
      lines: lines.filter((line, index) => {
        if (isSearchLine(line.text)) return false;
        if (line.bbox != null && Number.isFinite(line.bbox.y0)) {
          return line.bbox.y0 > cutoff;
        }
        // Geometry-less lines: keep only those after Search in reading order.
        return index > searchIndex;
      }),
      croppedBelowSearch: true,
    };
  }

  const searchIndex = lines.findIndex((line) => isSearchLine(line.text));
  if (searchIndex < 0) {
    return { lines, croppedBelowSearch: false };
  }

  return {
    lines: lines.slice(searchIndex + 1),
    croppedBelowSearch: true,
  };
}

/** Convenience for plain-string OCR fixtures. */
export function cropTextLinesBelowSearch(
  lines: string[],
): CropListRegionResult<{ text: string }> {
  return cropRosterLinesBelowSearch(lines.map((text) => ({ text })));
}

export function toRosterOcrLineLikes(
  lines: ExtractedOcrLine[],
): RosterOcrLineLike[] {
  return lines.map((line) => ({
    text: line.text,
    bbox: line.bbox
      ? { y0: line.bbox.y0, y1: line.bbox.y1 }
      : null,
  }));
}
