/**
 * Cluster OCR lines by vertical position into member-row bands.
 *
 * Member rows often split across lines (name on one line, Power/Lv on the next).
 * Section header bars (R-badge + custom title + quota) use a different signature.
 */

import type { RosterOcrLineLike } from "@/lib/members/roster-ocr/crop-list-region.shared";
import {
  hasMemberStats,
  hasQuotaPattern,
  isBareRankBadge,
  parseRankGroupHeader,
} from "@/lib/members/roster-ocr/segment-ranks";

const Y_CLUSTER_TOLERANCE_PX = 14;

export type AssembledMemberRowLine = {
  text: string;
  bbox?: { y0: number; y1: number } | null;
};

function lineY0(line: RosterOcrLineLike): number | null {
  if (line.bbox != null && Number.isFinite(line.bbox.y0)) {
    return line.bbox.y0;
  }
  return null;
}

function isHeaderBandLine(line: RosterOcrLineLike): boolean {
  const text = line.text.trim();
  if (!text) return true;
  if (isBareRankBadge(text)) return true;
  // No real section context exists at this geometry-clustering stage — probe
  // with no ctx so the same-rank guard in `parseRankGroupHeader` (which only
  // matters once a real rank is already established) never suppresses a
  // structurally header-shaped line here. Quota-only lines without a badge
  // are covered by the explicit check below regardless.
  if (parseRankGroupHeader(text) !== null) return true;
  if (hasQuotaPattern(text) && !hasMemberStats(text)) return true;
  return false;
}

function isMemberStatsLine(text: string): boolean {
  return hasMemberStats(text);
}

/**
 * Merge vertically adjacent OCR lines into single logical member rows.
 * Returns input unchanged when geometry is unavailable.
 */
export function assembleMemberRowLines<T extends RosterOcrLineLike>(
  lines: T[],
): AssembledMemberRowLine[] {
  const withY = lines.filter((line) => lineY0(line) != null);
  if (withY.length < 2) {
    return lines.map((line) => ({ text: line.text, bbox: line.bbox }));
  }

  const sorted = [...lines].sort((a, b) => {
    const ya = lineY0(a) ?? Number.MAX_SAFE_INTEGER;
    const yb = lineY0(b) ?? Number.MAX_SAFE_INTEGER;
    return ya - yb;
  });

  const bands: T[][] = [];
  let current: T[] = [];

  for (const line of sorted) {
    const y = lineY0(line);
    if (current.length === 0) {
      current.push(line);
      continue;
    }

    const prevY = lineY0(current[0]!);
    if (
      y != null &&
      prevY != null &&
      Math.abs(y - prevY) <= Y_CLUSTER_TOLERANCE_PX
    ) {
      current.push(line);
    } else {
      bands.push(current);
      current = [line];
    }
  }
  if (current.length > 0) bands.push(current);

  const assembled: AssembledMemberRowLine[] = [];

  for (const band of bands) {
    if (band.length === 1) {
      const line = band[0]!;
      assembled.push({ text: line.text, bbox: line.bbox });
      continue;
    }

    const texts = band.map((l) => l.text.trim()).filter(Boolean);
    const combined = texts.join(" ");

    // Header bands: keep separate lines so rank segmentation still works.
    if (band.some(isHeaderBandLine) && !band.some((l) => isMemberStatsLine(l.text))) {
      for (const line of band) {
        assembled.push({ text: line.text, bbox: line.bbox });
      }
      continue;
    }

    const y0 = Math.min(
      ...band.map((l) => lineY0(l) ?? Number.MAX_SAFE_INTEGER),
    );
    const y1 = Math.max(
      ...band
        .map((l) => l.bbox?.y1)
        .filter((v): v is number => v != null && Number.isFinite(v)),
      y0,
    );

    assembled.push({
      text: combined,
      bbox: Number.isFinite(y0) ? { y0, y1 } : band[0]?.bbox,
    });
  }

  return assembled;
}
