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

function parseWarzoneLine(
  line: string,
): { gameServerNumber: number; coordX: number; coordY: number } | null {
  const warzoneMatch = line.match(WARZONE_COORDS_RE);
  if (!warzoneMatch) return null;
  const gameServerNumber = Number(warzoneMatch[1]);
  const coordX = Number(warzoneMatch[2]);
  const coordY = Number(warzoneMatch[3]);
  if (!isPlausibleCoord(gameServerNumber, coordX, coordY)) return null;
  return { gameServerNumber, coordX, coordY };
}

function findBannerLineIndex(lines: readonly string[]): number {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (LEVEL_RE.test(line) && TAG_NAME_RE.test(line)) return i;
  }
  for (let i = 0; i < lines.length; i++) {
    if (LEVEL_RE.test(lines[i]!)) return i;
  }
  return -1;
}

function findPrimerWarzone(
  lines: readonly string[],
  bannerLineIndex: number,
): { gameServerNumber: number; coordX: number; coordY: number } | null {
  if (bannerLineIndex >= 0) {
    for (const delta of [-1, 0, 1]) {
      const index = bannerLineIndex + delta;
      if (index < 0 || index >= lines.length) continue;
      const parsed = parseWarzoneLine(lines[index]!);
      if (parsed) return parsed;
    }
  }

  for (const line of lines) {
    const parsed = parseWarzoneLine(line);
    if (parsed) return parsed;
  }

  return null;
}

/**
 * Parse OCR lines from the Add to Favorites menu.
 * Returns null when warzone coordinates are not found or implausible.
 */
export function parseFavoritesText(
  lines: readonly string[],
): ParsedFavoritesFrame | null {
  const normalized = lines
    .map((rawLine) => rawLine.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);

  const bannerLineIndex = findBannerLineIndex(normalized);
  const warzone = findPrimerWarzone(normalized, bannerLineIndex);
  if (!warzone) return null;

  let level: number | null = null;
  let owningAllianceTag: string | null = null;
  let bankName: string | null = null;

  if (bannerLineIndex >= 0) {
    const bannerLine = normalized[bannerLineIndex]!;
    const levelMatch = bannerLine.match(LEVEL_RE);
    if (levelMatch) {
      const parsed = Number(levelMatch[1]);
      if (Number.isFinite(parsed) && parsed > 0) level = parsed;
    }
    const tagNameMatch = bannerLine.match(TAG_NAME_RE);
    if (tagNameMatch) {
      const tag = tagNameMatch[1]!.trim();
      const name = tagNameMatch[2]!.trim();
      if (tag) owningAllianceTag = tag;
      if (name) bankName = name;
    }
  }

  return {
    gameServerNumber: warzone.gameServerNumber,
    coordX: warzone.coordX,
    coordY: warzone.coordY,
    level,
    owningAllianceTag,
    bankName,
  };
}
