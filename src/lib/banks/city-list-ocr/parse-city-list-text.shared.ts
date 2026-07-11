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
 * so parsing is done by scanning *all* lines for each token type (in reading
 * order) and zipping same-index matches back into per-tile banks, rather than
 * assuming one bank per line.
 */

export type ParsedCityListBank = {
  level: number;
  /** CrystalGold value shown on the tile, e.g. 600000 for "600.00K". */
  crystalGoldValue: number;
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

const HEADER_OR_FOOTER_RE =
  /total\s+crystalgold\s+deposited|bank\s+strongholds?\s+captured|bank\s+stronghold\s+captures\s+left|server\s*time/i;

const SUFFIX_MULTIPLIER: Record<string, number> = {
  K: 1_000,
  M: 1_000_000,
  B: 1_000_000_000,
};

/** Compact CrystalGold value token, e.g. "600.00K", "3.48M". */
const VALUE_TOKEN_RE = /(\d[\d,]*(?:\.\d+)?)\s*([KMB])\b/gi;

/** Bank level token, e.g. "Lv.3", "Lv 2". */
const LEVEL_TOKEN_RE = /\bLv\.?\s*(\d+)\b/gi;

/** Bank coordinate token, e.g. "#1211 (X:599, Y:499)" or "#1211 [X:699, Y:599]". */
const COORD_TOKEN_RE =
  /#\s*(\d{3,6})\s*[([]\s*X\s*:\s*(\d+)\s*,\s*Y\s*:\s*(\d+)\s*[)\]]/gi;

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
  const base = Number(amount.replace(/,/g, ""));
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

function extractAll<T>(
  lines: readonly string[],
  regex: RegExp,
  map: (match: RegExpExecArray) => T,
  options: { skipHeaderFooterLines?: boolean } = {},
): T[] {
  const results: T[] = [];
  for (const line of lines) {
    if (options.skipHeaderFooterLines && isHeaderOrFooterLine(line)) continue;
    const re = new RegExp(regex.source, regex.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(line)) != null) {
      results.push(map(match));
    }
  }
  return results;
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
 * Parse per-tile bank data by scanning every line for each token type (value,
 * level, coordinates, deposit usage) in reading order, then zipping matches
 * of the same index back together. This is robust whether OCR emits one line
 * per tile or merges whole tile-rows into single lines.
 */
export function parseCityListBanks(
  lines: readonly string[],
): ParsedCityListBank[] {
  const values = extractAll(
    lines,
    VALUE_TOKEN_RE,
    (m) => parseCompactCrystalGoldValue(m[1]!, m[2]),
    { skipHeaderFooterLines: true },
  );
  const levels = extractAll(lines, LEVEL_TOKEN_RE, (m) => Number(m[1]), {
    skipHeaderFooterLines: true,
  });
  const coords = extractAll(
    lines,
    COORD_TOKEN_RE,
    (m) => ({
      gameServerNumber: Number(m[1]),
      coordX: Number(m[2]),
      coordY: Number(m[3]),
    }),
    { skipHeaderFooterLines: true },
  );
  const deposits = extractAll(lines, DEPOSIT_TOKEN_RE, (m) => Number(m[1]), {
    skipHeaderFooterLines: true,
  });

  const count = Math.min(values.length, levels.length, coords.length);
  const banks: ParsedCityListBank[] = [];
  for (let i = 0; i < count; i += 1) {
    const value = values[i];
    const level = levels[i];
    const coord = coords[i];
    if (value == null || level == null || !coord) continue;
    banks.push({
      level,
      crystalGoldValue: value,
      gameServerNumber: coord.gameServerNumber,
      coordX: coord.coordX,
      coordY: coord.coordY,
      currentDepositCount: deposits[i] ?? null,
    });
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
