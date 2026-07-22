/**
 * Client-safe "Add to Favorites" menu line parsers.
 * Expects OCR text from the in-game favorites dialog (warzone coords + bank name).
 */

export type ParsedFavoritesFrame = {
  gameServerNumber: number;
  coordX: number;
  coordY: number;
  level: number | null;
  owningAllianceTag: string | null;
  bankName: string | null;
};

/** Last War map coords are always in [0, 1000). */
const COORD_MAX_EXCLUSIVE = 1000;

const WARZONE_COORDS_RE =
  /warzone\s+#?\s*(\d{3,6})\s+[Xx]\s*:?\s*(\d+)\s+[YyVv]\s*:?\s*(\d+)/i;

const LEVEL_RE = /\bL\.?v\.?i?[.:']?\s*(\d+)\b/i;

/** Alliance tag + bank name, e.g. `[BigD]Trailblazer Bank`. */
const TAG_NAME_RE = /\[\s*([^\]]+?)\s*\]\s*(.+?)\s*$/;

function isPlausibleCoord(
  gameServerNumber: number,
  coordX: number,
  coordY: number,
): boolean {
  return (
    Number.isFinite(gameServerNumber) &&
    gameServerNumber >= 100 &&
    gameServerNumber <= 999_999 &&
    Number.isInteger(coordX) &&
    Number.isInteger(coordY) &&
    coordX >= 0 &&
    coordX < COORD_MAX_EXCLUSIVE &&
    coordY >= 0 &&
    coordY < COORD_MAX_EXCLUSIVE
  );
}

/**
 * Parse OCR lines from the Add to Favorites menu.
 * Returns null when warzone coordinates are not found or implausible.
 */
export function parseFavoritesText(
  lines: readonly string[],
): ParsedFavoritesFrame | null {
  let gameServerNumber: number | null = null;
  let coordX: number | null = null;
  let coordY: number | null = null;
  let level: number | null = null;
  let owningAllianceTag: string | null = null;
  let bankName: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) continue;

    const warzoneMatch = line.match(WARZONE_COORDS_RE);
    if (warzoneMatch) {
      const server = Number(warzoneMatch[1]);
      const x = Number(warzoneMatch[2]);
      const y = Number(warzoneMatch[3]);
      if (isPlausibleCoord(server, x, y)) {
        gameServerNumber = server;
        coordX = x;
        coordY = y;
      }
    }

    const levelMatch = line.match(LEVEL_RE);
    if (levelMatch && level == null) {
      const parsed = Number(levelMatch[1]);
      if (Number.isFinite(parsed) && parsed > 0) level = parsed;
    }

    const tagNameMatch = line.match(TAG_NAME_RE);
    if (tagNameMatch) {
      const tag = tagNameMatch[1]!.trim();
      const name = tagNameMatch[2]!.trim();
      if (tag) owningAllianceTag = tag;
      if (name) bankName = name;
    }
  }

  if (
    gameServerNumber == null ||
    coordX == null ||
    coordY == null
  ) {
    return null;
  }

  return {
    gameServerNumber,
    coordX,
    coordY,
    level,
    owningAllianceTag,
    bankName,
  };
}
