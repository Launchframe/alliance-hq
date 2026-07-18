/**
 * Client-safe City List → "Bank Stronghold" tab line parsers.
 *
 * Expects OCR text from the in-game City List overlay's Bank Stronghold tab,
 * a grid of bank tiles (icon/value, level, coordinates, deposit progress)
 * plus a header (total deposited, captured count) and footer (server time,
 * captures remaining today).
 *
 * Tesseract commonly merges same-row tiles into a single text line (since the
 * three tile columns share the same vertical band), e.g.
 *   "600.00K 600.00K 600.00K"
 *   "Lv.3 Lv.2 Lv.2"
 *   "#1211 (X:599, Y:499) #1211 (X:699, Y:599) #1211 (X:699, Y:499)"
 *   "100/100 100/100 100/100"
 * so parsing groups tokens **per grid row** (coord line as the anchor), then
 * zips same-index matches within that row — not across the whole screenshot.
 * A global index-zip would mis-assign amounts when one row recovers fewer
 * K-tokens than coord anchors.
 *
 * Real OCR is noisier than the golden transcription: coordinates often lose
 * parentheses (`#1211x:699,v:399)`), confuse `Y` with `V`, drop the leading
 * `#`, glue server+X (`#1211599, V:499)`), and mangle levels into `Lv:3` /
 * `Lvi3`. Levels/deposits are optional; missing amounts stay null.
 */

export type ParsedCityListBank = {
  level: number;
  /** CrystalGold value shown on the tile, e.g. 600000 for "600.00K". Null if OCR missed it. */
  crystalGoldValue: number | null;
  gameServerNumber: number;
  coordX: number;
  coordY: number;
  /** Deposit slot usage (cap 100 or 110 by level), e.g. 81 for "81/100". Null if unreadable. */
  currentDepositCount: number | null;
};

export type ParsedCityListSnapshot = {
  banks: ParsedCityListBank[];
  /** "Total CrystalGold Deposited" header value, if present. */
  totalCrystalGoldDeposited: number | null;
  /** "Bank Strongholds captured: N/M" — N (owned right now). */
  capturedCount: number | null;
  /** "Bank Strongholds captured: N/M" — M (alliance's total slot cap). */
  capturedLimit: number | null;
  /** "Bank Stronghold captures left today: a/b" — a (remaining). */
  capturesRemainingToday: number | null;
  /** "Bank Stronghold captures left today: a/b" — b (daily limit). */
  capturesLimitToday: number | null;
  /** "Server Time: ..." footer, treated as UTC wall-clock, ISO string. */
  serverTime: string | null;
  /** True when the screenshot shows every currently-captured bank. */
  isComplete: boolean;
};

/** Default level when OCR drops every `Lv.N` token for a tile. Officers can fix in review. */
export const CITY_LIST_DEFAULT_LEVEL = 1;

const HEADER_OR_FOOTER_RE =
  /total\s+crystalgold\s+deposited|bank\s+strongholds?\s+captured|bank\s+stronghold\s+captures\s+left|server\s*time/i;

const SUFFIX_MULTIPLIER: Record<string, number> = {
  K: 1_000,
  M: 1_000_000,
  B: 1_000_000_000,
};

/**
 * Compact CrystalGold value token, e.g. "600.00K", "3.48M", OCR "59726K",
 * spaced decimals ("447 38K", "588. 00K"), and K→N misreads ("522 00N").
 */
const VALUE_TOKEN_RE =
  /(\d[\d.oO]*)(?:\s*[.\s]\s*(\d{2}))?\s*([KkMmBbNn])\b/g;

/**
 * Bank level token. Real OCR often inserts punctuation or an extra `i`:
 *   "Lv.3" "Lv 2" "Lv:3" "Lv'3" "Lvi3" "LvI2" "LV.2"
 */
const LEVEL_TOKEN_RE = /\bL\.?v\.?i?[.:']?\s*(\d+)\b/gi;

/**
 * Bank coordinate token.
 * Accepts clean `#1211 (X:599, Y:499)` and OCR garbles like:
 *   `#1211x:699,v:399)`  `#1211(X:699,V:299)`  `#1211 [X:699, ¥:499]`
 *   `1203 [X:499, Y:799]` (hash dropped)
 * (`V`/`v`/`¥` are common Tesseract misreads of `Y`.)
 * `#` is optional when an X-label is present.
 */
const COORD_TOKEN_RE =
  /#?\s*(\d{3,6})\s*[([]?\s*[Xx]\s*:?\s*(\d+)\s*,\s*[^0-9]*(\d+)\s*[)\]]?/gi;

/**
 * Fallback when OCR glues server+X and drops the X label:
 *   `(#1211599, V:499)` → server 1211, X 599, Y 499
 *
 * Digit split is ambiguous (`#999599` → 9995/99 vs 999/599). Try a 4-digit
 * server first, then 3-digit. Map coords are always in [0, 1000), so X never
 * has 4 digits. When both splits are plausible, prefer the one whose X digit
 * length matches Y (typical OCR of nearby map coords).
 */
const COORD_GLUED_RE =
  /#\s*(\d{5,8})\s*,\s*[^0-9]*(\d{1,3})\s*[)\]]?/gi;

function digitLength(n: number): number {
  if (!Number.isFinite(n) || n === 0) return 1;
  return Math.floor(Math.abs(n)).toString().length;
}

function parseGluedServerAndX(
  serverAndX: string,
  coordY: number,
): { gameServerNumber: number; coordX: number; coordY: number } | null {
  const candidates: Array<{
    gameServerNumber: number;
    coordX: number;
    coordY: number;
  }> = [];

  for (const serverLen of [4, 3] as const) {
    if (serverAndX.length <= serverLen) continue;
    const gameServerNumber = Number(serverAndX.slice(0, serverLen));
    const coordX = Number(serverAndX.slice(serverLen));
    if (!Number.isInteger(coordX)) continue;
    // X is at most 3 digits on the map ([0, 1000)).
    if (serverAndX.length - serverLen > 3) continue;
    if (!isPlausibleCityListCoord(gameServerNumber, coordX, coordY)) continue;
    candidates.push({ gameServerNumber, coordX, coordY });
  }

  if (candidates.length === 0) return null;
  const matchingMagnitude = candidates.find(
    (c) => digitLength(c.coordX) === digitLength(c.coordY),
  );
  return matchingMagnitude ?? candidates[0]!;
}

/** Deposit slot usage token, e.g. "81/100" or "95/110" (level 6+ banks). */
const DEPOSIT_TOKEN_RE = /\b(\d{1,3})\s*\/\s*(100|110)\b/g;

/** Absolute maximum deposit slot capacity across all bank levels. */
const BANK_DEPOSIT_CAPACITY_MAX = 110;

/**
 * OCR sometimes prepends digits from adjacent tile text to a deposit count
 * (e.g. "271/100" when the real count is 71). Strip leading digits until
 * the value is within the game's maximum capacity.
 */
export function clampOcrDepositCount(raw: number): number {
  let n = raw;
  while (n > BANK_DEPOSIT_CAPACITY_MAX) {
    const s = String(n);
    if (s.length <= 1) break;
    n = Number(s.slice(1));
  }
  return n;
}

const TOTAL_DEPOSITED_RE =
  /total\s+crystalgold\s+deposited:?\s*(\d[\d,]*(?:\.\d+)?)\s*([KMB])?/i;

const CAPTURED_RE = /bank\s+strongholds?\s+captured:?\s*(\d+)\s*\/\s*(\d+)/i;

const CAPTURES_LEFT_RE =
  /bank\s+stronghold\s+captures\s+left\s+today:?\s*(\d+)\s*\/\s*(\d+)/i;

const SERVER_TIME_RE =
  /server\s*time:?\s*(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})/i;

/** Parse a compact CrystalGold value token (e.g. "600.00K", "3.48M") to a number. */
export function parseCompactCrystalGoldValue(
  amount: string,
  suffix: string | undefined,
): number | null {
  // OCR often reads `0` as `O`/`o` inside amounts.
  let cleaned = amount.replace(/,/g, "").replace(/[oO]/g, "0");
  // Trailing decimal from spaced OCR ("588." + "00K").
  if (cleaned.endsWith(".")) cleaned = cleaned.slice(0, -1);
  // Tile amounts are shown with two decimals (600.00K). When the decimal
  // point is lost ("59726K"), re-insert it before the last two digits.
  if (!cleaned.includes(".") && cleaned.length >= 5 && suffix) {
    cleaned = `${cleaned.slice(0, -2)}.${cleaned.slice(-2)}`;
  }
  const base = Number(cleaned);
  if (!Number.isFinite(base)) return null;
  // Soft OCR often misreads the K suffix as N ("522 00N").
  const normalizedSuffix =
    suffix && /^n$/i.test(suffix) ? "K" : suffix?.toUpperCase();
  const multiplier = normalizedSuffix
    ? SUFFIX_MULTIPLIER[normalizedSuffix] ?? 1
    : 1;
  return Math.round(base * multiplier);
}

/** Last War City List map coords are always in [0, 1000). */
const CITY_LIST_COORD_MAX_EXCLUSIVE = 1000;

function isPlausibleCityListCoord(
  gameServerNumber: number,
  coordX: number,
  coordY: number,
): boolean {
  return (
    Number.isFinite(gameServerNumber) &&
    Number.isFinite(coordX) &&
    Number.isFinite(coordY) &&
    gameServerNumber >= 100 &&
    gameServerNumber <= 999_999 &&
    Number.isInteger(coordX) &&
    Number.isInteger(coordY) &&
    coordX >= 0 &&
    coordX < CITY_LIST_COORD_MAX_EXCLUSIVE &&
    coordY >= 0 &&
    coordY < CITY_LIST_COORD_MAX_EXCLUSIVE
  );
}

function extractCoordsFromLine(line: string): Array<{
  gameServerNumber: number;
  coordX: number;
  coordY: number;
}> {
  const labeled = extractFromLine(line, COORD_TOKEN_RE, (m) => {
    const gameServerNumber = Number(m[1]);
    const coordX = Number(m[2]);
    const coordY = Number(m[3]);
    if (!isPlausibleCityListCoord(gameServerNumber, coordX, coordY)) {
      return null;
    }
    return { gameServerNumber, coordX, coordY };
  });
  if (labeled.length > 0) return labeled;

  // Only use glued server+X when no labeled X: tokens matched.
  return extractFromLine(line, COORD_GLUED_RE, (m) => {
    const serverAndX = m[1]!;
    const coordY = Number(m[2]);
    return parseGluedServerAndX(serverAndX, coordY);
  });
}

function extractValuesFromLine(line: string): Array<number | null> {
  return extractFromLine(line, VALUE_TOKEN_RE, (m) => {
    const whole = m[1]!;
    const decimals = m[2];
    const suffix = m[3];
    const amount = decimals != null ? `${whole.replace(/\.$/, "")}.${decimals}` : whole;
    return parseCompactCrystalGoldValue(amount, suffix);
  });
}

/** Game server timestamps are wall-clock without TZ; treat as UTC for storage. */
export function parseCityListServerTime(raw: string): string | null {
  const match = raw.match(SERVER_TIME_RE);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const iso = `${y}-${mo!.padStart(2, "0")}-${d!.padStart(2, "0")}T${h!.padStart(2, "0")}:${mi}:${s}.000Z`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function isHeaderOrFooterLine(line: string): boolean {
  return HEADER_OR_FOOTER_RE.test(line);
}

function extractFromLine<T>(
  line: string,
  regex: RegExp,
  map: (match: RegExpExecArray) => T | null,
): T[] {
  const results: T[] = [];
  const re = new RegExp(regex.source, regex.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) != null) {
    const mapped = map(match);
    if (mapped != null) results.push(mapped);
  }
  return results;
}

type LineTokens = {
  values: Array<number | null>;
  levels: number[];
  coords: Array<{
    gameServerNumber: number;
    coordX: number;
    coordY: number;
  }>;
  deposits: number[];
  isHeaderFooter: boolean;
};

function tokenizeCityListLine(line: string): LineTokens {
  const isHeaderFooter = isHeaderOrFooterLine(line);
  if (isHeaderFooter) {
    return {
      values: [],
      levels: [],
      coords: [],
      deposits: [],
      isHeaderFooter: true,
    };
  }
  return {
    values: extractValuesFromLine(line),
    levels: extractFromLine(line, LEVEL_TOKEN_RE, (m) => Number(m[1])),
    coords: extractCoordsFromLine(line),
    deposits: extractFromLine(line, DEPOSIT_TOKEN_RE, (m) =>
      clampOcrDepositCount(Number(m[1])),
    ),
    isHeaderFooter: false,
  };
}

/** True when the line is only deposit progress (previous row's trailing line). */
function isDepositOnlyLine(tokens: LineTokens): boolean {
  return (
    !tokens.isHeaderFooter &&
    tokens.deposits.length > 0 &&
    tokens.values.length === 0 &&
    tokens.levels.length === 0 &&
    tokens.coords.length === 0
  );
}

/** Parse header fields: total CrystalGold deposited + captured count/limit. */
export function parseCityListHeader(lines: readonly string[]): {
  totalCrystalGoldDeposited: number | null;
  capturedCount: number | null;
  capturedLimit: number | null;
} {
  let totalCrystalGoldDeposited: number | null = null;
  let capturedCount: number | null = null;
  let capturedLimit: number | null = null;

  for (const line of lines) {
    const totalMatch = line.match(TOTAL_DEPOSITED_RE);
    if (totalMatch && totalCrystalGoldDeposited == null) {
      totalCrystalGoldDeposited = parseCompactCrystalGoldValue(
        totalMatch[1]!,
        totalMatch[2],
      );
    }
    const capturedMatch = line.match(CAPTURED_RE);
    if (capturedMatch && capturedCount == null) {
      capturedCount = Number(capturedMatch[1]);
      capturedLimit = Number(capturedMatch[2]);
    }
  }

  return { totalCrystalGoldDeposited, capturedCount, capturedLimit };
}

/** Parse footer fields: server time + captures remaining today. */
export function parseCityListFooter(lines: readonly string[]): {
  serverTime: string | null;
  capturesRemainingToday: number | null;
  capturesLimitToday: number | null;
} {
  let serverTime: string | null = null;
  let capturesRemainingToday: number | null = null;
  let capturesLimitToday: number | null = null;

  for (const line of lines) {
    if (serverTime == null) {
      const ts = parseCityListServerTime(line);
      if (ts) serverTime = ts;
    }
    const leftMatch = line.match(CAPTURES_LEFT_RE);
    if (leftMatch && capturesRemainingToday == null) {
      capturesRemainingToday = Number(leftMatch[1]);
      capturesLimitToday = Number(leftMatch[2]);
    }
  }

  return { serverTime, capturesRemainingToday, capturesLimitToday };
}

/**
 * Parse per-tile bank data by grouping tokens around each coordinate line
 * (one grid row), then zipping value/level/deposit with coords **within that
 * row**. Coordinates are the identity anchor — OCR often drops `Lv.` rows and
 * some CrystalGold amounts on dark cards. Missing amounts stay null for
 * officer review rather than discarding the whole tile or borrowing amounts
 * from the next row.
 *
 * When a tile-row's own coordinate line is *completely* unreadable (zero
 * matches from both `COORD_TOKEN_RE` and `COORD_GLUED_RE`), that line drops
 * out of `coordLineIndices` entirely and its value/level lines land in the
 * pre-line window of the *next* surviving coordinate row. Without care,
 * those orphaned tokens would zip onto the next row's real coordinates and
 * silently corrupt otherwise-good data (see the value/level reset below).
 * The orphaned row's tile itself is unrecoverable here — no anchor exists
 * for it — but the caller can still detect the gap via the "Bank
 * Strongholds captured: N/M" header count and prompt for manual entry.
 */
export function parseCityListBanks(
  lines: readonly string[],
): ParsedCityListBank[] {
  const tokenized = lines.map(tokenizeCityListLine);
  const coordLineIndices: number[] = [];
  for (let i = 0; i < tokenized.length; i += 1) {
    if (tokenized[i]!.coords.length > 0) coordLineIndices.push(i);
  }
  if (coordLineIndices.length === 0) return [];

  const banks: ParsedCityListBank[] = [];
  for (let row = 0; row < coordLineIndices.length; row += 1) {
    const coordLineIndex = coordLineIndices[row]!;
    const prevCoordLineIndex =
      row > 0 ? coordLineIndices[row - 1]! : -1;
    const nextCoordLineIndex =
      row + 1 < coordLineIndices.length
        ? coordLineIndices[row + 1]!
        : tokenized.length;

    // Skip trailing deposit-only lines that belong to the previous row.
    let preStart = prevCoordLineIndex + 1;
    while (
      preStart < coordLineIndex &&
      isDepositOnlyLine(tokenized[preStart]!)
    ) {
      preStart += 1;
    }

    const values: Array<number | null> = [];
    const levels: number[] = [];
    for (let i = preStart; i < coordLineIndex; i += 1) {
      const tokens = tokenized[i]!;
      if (tokens.isHeaderFooter) continue;
      // A second value/level line before reaching this row's own coordinate
      // line means an earlier tile-row's coordinate line was fully
      // unreadable (dropped from `coordLineIndices`). Discard its orphaned
      // tokens instead of zipping them onto this row's coordinates — that
      // tile is unrecoverable without a coordinate anchor, but it must not
      // corrupt this row's real data.
      if (
        (tokens.values.length > 0 && values.length > 0) ||
        (tokens.levels.length > 0 && levels.length > 0)
      ) {
        values.length = 0;
        levels.length = 0;
      }
      values.push(...tokens.values);
      levels.push(...tokens.levels);
    }

    const coordLine = tokenized[coordLineIndex]!;
    // Rare: value/level tokens on the same line as coordinates.
    values.push(...coordLine.values);
    levels.push(...coordLine.levels);
    const coords = coordLine.coords;

    const deposits: number[] = [...coordLine.deposits];
    for (let i = coordLineIndex + 1; i < nextCoordLineIndex; i += 1) {
      const tokens = tokenized[i]!;
      if (tokens.isHeaderFooter) continue;
      // A value line starts the next grid row (deposits already ended).
      if (tokens.values.length > 0 && tokens.coords.length === 0) break;
      deposits.push(...tokens.deposits);
    }

    for (let i = 0; i < coords.length; i += 1) {
      const coord = coords[i]!;
      const level = levels[i];
      const rawValue = values[i];
      banks.push({
        level:
          level != null && Number.isFinite(level) && level > 0
            ? level
            : CITY_LIST_DEFAULT_LEVEL,
        // OCR junk like "000k" parses to 0 — treat as missing for review.
        crystalGoldValue:
          rawValue != null && rawValue > 0 ? rawValue : null,
        gameServerNumber: coord.gameServerNumber,
        coordX: coord.coordX,
        coordY: coord.coordY,
        currentDepositCount: deposits[i] ?? null,
      });
    }
  }
  return banks;
}

/**
 * Parse OCR lines from the City List Bank Stronghold tab into a structured
 * snapshot of banks + header/footer metadata.
 */
export function parseCityListText(
  lines: readonly string[],
): ParsedCityListSnapshot {
  const header = parseCityListHeader(lines);
  const footer = parseCityListFooter(lines);
  const banks = parseCityListBanks(lines);

  const isComplete =
    header.capturedCount != null && banks.length === header.capturedCount;

  return {
    banks,
    totalCrystalGoldDeposited: header.totalCrystalGoldDeposited,
    capturedCount: header.capturedCount,
    capturedLimit: header.capturedLimit,
    capturesRemainingToday: footer.capturesRemainingToday,
    capturesLimitToday: footer.capturesLimitToday,
    serverTime: footer.serverTime,
    isComplete,
  };
}
