/**
 * Detect whether a Last War screenshot still has the phone HUD.
 *
 * An uncropped phone shot starts with the resource bar: a row of short
 * decimals and K/M/G suffixes (166.7M, 3,4G). A crop that keeps only an
 * in-game menu starts on that menu's title and has neither. Other menus
 * can reuse this; it does not describe every screen.
 */

export type InGameScreenshotLayout = "phone" | "menu";

/** Top band that holds the resource HUD on a portrait phone screenshot. */
export const IN_GAME_CROP_TOP_FRACTION = 0.12;
export const IN_GAME_CROP_TOP_MIN_PX = 36;

/**
 * A full phone screenshot is about 9:16 or taller. A crop that keeps only
 * the Power Details card is wide. Portrait frames stay on the phone window
 * even when the resource-bar OCR misses a decimal or a suffix. That miss
 * used to select the menu crop, which is the wrong window for a full screenshot.
 */
export const IN_GAME_PHONE_FRAME_MIN_RATIO = 1.6;

/** 166.7 or 3,46 — dot or comma decimal, not a thousand-grouped integer. */
const RESOURCE_DECIMAL_RE = /\d{1,3}[.,]\d{1,2}/g;
const RESOURCE_SUFFIX_RE = /[KMG]/gi;

export function inGameTopStripBox(
  width: number,
  height: number,
): { left: number; top: number; width: number; height: number } {
  const stripHeight = Math.min(
    height,
    Math.max(
      Math.min(IN_GAME_CROP_TOP_MIN_PX, height),
      Math.round(height * IN_GAME_CROP_TOP_FRACTION),
    ),
  );
  return { left: 0, top: 0, width, height: stripHeight };
}

export function resourceHudDecimals(text: string): string[] {
  return text.match(RESOURCE_DECIMAL_RE) ?? [];
}

export function resourceHudSuffixes(text: string): string[] {
  return text.match(RESOURCE_SUFFIX_RE) ?? [];
}

/**
 * True when the top-row OCR still looks like the resource HUD.
 *
 * One decimal and one suffix are enough. Tesseract often splits `173.5M`
 * into `173.5` and `M`, and it drops some of the three amounts.
 */
export function topRowHasResourceHud(text: string): boolean {
  return (
    resourceHudDecimals(text).length > 0 && resourceHudSuffixes(text).length > 0
  );
}

export function isPortraitPhoneFrame(width: number, height: number): boolean {
  return width > 0 && height / width >= IN_GAME_PHONE_FRAME_MIN_RATIO;
}

export function inGameScreenshotLayoutFromTopRow(
  text: string,
  dimensions?: { width: number; height: number },
): InGameScreenshotLayout {
  if (
    dimensions != null &&
    isPortraitPhoneFrame(dimensions.width, dimensions.height)
  ) {
    return "phone";
  }
  return topRowHasResourceHud(text) ? "phone" : "menu";
}
