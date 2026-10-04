import {
  hammingDistanceHex,
  ICON_PHASH_MATCH_THRESHOLD,
} from "@/lib/vs-calculator/icon-phash.shared";

export type VsIconTemplate = {
  slug: string;
  displayName: string;
  iconPhash: string;
};

export type IconMatchResult = {
  slug: string;
  displayName: string;
  distance: number;
  confidence: number;
} | null;

export function matchIconPhash(
  cellPhash: string,
  templates: VsIconTemplate[],
): IconMatchResult {
  if (!cellPhash || templates.length === 0) return null;

  let best: IconMatchResult = null;
  for (const template of templates) {
    if (!template.iconPhash) continue;
    const distance = hammingDistanceHex(cellPhash, template.iconPhash);
    if (distance > ICON_PHASH_MATCH_THRESHOLD) continue;
    if (!best || distance < best.distance) {
      best = {
        slug: template.slug,
        displayName: template.displayName,
        distance,
        confidence: Math.max(0, 1 - distance / (ICON_PHASH_MATCH_THRESHOLD + 1)),
      };
    }
  }
  return best;
}
