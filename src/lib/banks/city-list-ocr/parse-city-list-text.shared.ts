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
 * parentheses (`#1211x:699,v:399)`), confuse `Y` with `V`, and skip `Lv.`
 * lines entirely. Levels/deposits are optional; missing amounts stay null.
 */

export type ParsedCityListBank = {
  level: number;
  /** CrystalGold value shown on the tile, e.g. 600000 for "600.00K". Null if OCR missed it. */
  crystalGoldValue: number | null;
  gameServerNumber: number;
  coordX: number;
  coordY: number;
  /** Deposit slot usage out of 100, e.g. 81 for "81/100". Null if unreadable. */
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

/** Compact CrystalGold value token, e.g. "600.00K", "3.48M", OCR "59726K". */
const VALUE_TOKEN_RE = /(\d[\d.oO]*)\s*([KkMmBb])\b/g;

/** Bank level token, e.g. "Lv.3", "Lv 2", "LV.2". */
const LEVEL_TOKEN_RE = /\bL\.?v\.?\s*(\d+)\b/gi;

/**
 * Bank coordinate token.
 * Accepts clean `#1211 (X:599, Y:499)` and OCR garbles like:
 *   `#1211x:699,v:399)`  `#1211(X:699,V:299)`  `#1211 [X:699, ¥:499]`
 * (`V`/`v`/`¥` are common Tesseract misreads of `Y`.)
 */
const COORD_TOKEN_RE =
  /#\s*(\d{3,6})\s*[([]?\s*[Xx]\s*:?\s*(\d+)\s*,\s*[^0-9]*(\d+)\s*[)\]]?/gi;

/** Deposit slot usage token, e.g. "81/100". */
const DEPOSIT_TOKEN_RE = /\b(\d{1,3})\s*\/\s*100\b/g;

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
  // Tile amounts are shown with two decimals (600.00K). When the decimal
  // point is lost ("59726K"), re-insert it before the last two digits.
  if (!cleaned.includes(".") && cleaned.length >= 5 && suffix) {
    cleaned = `${cleaned.slice(0, -2)}.${cleaned.slice(-2)}`;
  }
  const base = Number(cleaned);
  if (!Number.isFinite(base)) return null;
  const multiplier = suffix ? SUFFIX_MULTIPLIER[suffix.toUpperCase()] ?? 1 : 1;
  return Math.round(base * multiplier);
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
    values: extractFromLine(line, VALUE_TOKEN_RE, (m) =>
      parseCompactCrystalGoldValue(m[1]!, m[2]),
    ),
    levels: extractFromLine(line, LEVEL_TOKEN_RE, (m) => Number(m[1])),
    coords: extractFromLine(line, COORD_TOKEN_RE, (m) => ({
      gameServerNumber: Number(m[1]),
      coordX: Number(m[2]),
      coordY: Number(m[3]),
    })),
    deposits: extractFromLine(line, DEPOSIT_TOKEN_RE, (m) => Number(m[1])),
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
      banks.push({
        level:
          level != null && Number.isFinite(level) && level > 0
            ? level
            : CITY_LIST_DEFAULT_LEVEL,
        crystalGoldValue: values[i] ?? null,
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
