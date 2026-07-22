/**
 * Client-safe Bank Information menu line parsers.
 * Expects OCR text from the in-game bank detail overlay (deposit value,
 * level, city owner, first capture date).
 */

export type ParsedBankInfoFrame = {
  gameServerNumber: number | null;
  owningAllianceTag: string | null;
  bankName: string | null;
  level: number | null;
  currentDepositValue: number | null;
  depositCapacity: number | null;
  firstCaptureDate: string | null;
};

/** Bank level token — mirrors city-list OCR tolerance (`Lv.1`, `Lv:1`, `Lvi3`). */
const LEVEL_RE = /\bL\.?v\.?i?[.:']?\s*(\d+)\b/i;

/** Title/possession line, e.g. `#1203 [BigD]Trailblazer Bank` or `#1203[BigD]Trailblazer Bank`. */
const TITLE_POSSESSION_RE =
  /^#(\d{3,6})\s*\[\s*([^\]]+?)\s*\]\s*(.+?)\s*$/;

/** City owner line — preferred tag source. */
const CITY_OWNER_RE =
  /city\s+owner:?\s*#(\d{3,6})\s*\[\s*([^\]]+?)\s*\]\s*(.+?)\s*$/i;

/** CrystalGold deposit progress, e.g. `29,387/600,000`. */
const DEPOSIT_VALUE_RE = /\b([\d,]+)\s*\/\s*([\d,]+)\b/;

const FIRST_CAPTURE_RE =
  /first\s+capture\s+time\s+of\s+this\s+city\s+is?\s*(\d{4})-(\d{1,2})-(\d{1,2})/i;

function parseIntAmount(raw: string): number | null {
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
}

function parseFirstCaptureDate(raw: string): string | null {
  const match = raw.match(FIRST_CAPTURE_RE);
  if (!match) return null;
  const [, y, mo, d] = match;
  return `${y}-${mo!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
}

/**
 * Title/possession lines alone are not enough — Deposit Slip History identity
 * rows (`#SERVER[TAG]Commander`) share that shape and must not become a false
 * bank-context parse. Require at least one Bank Information–specific signal.
 */
function hasBankInfoSignal(input: {
  hadCityOwner: boolean;
  level: number | null;
  currentDepositValue: number | null;
  depositCapacity: number | null;
  firstCaptureDate: string | null;
}): boolean {
  return (
    input.hadCityOwner ||
    input.level != null ||
    input.currentDepositValue != null ||
    input.depositCapacity != null ||
    input.firstCaptureDate != null
  );
}

/**
 * Parse OCR lines from the Bank Information menu into structured fields.
 * Returns null when no bank-info-specific signal matched (level, deposit
 * ratio, city owner, or first capture date).
 */
export function parseBankInfoText(
  lines: readonly string[],
): ParsedBankInfoFrame | null {
  let gameServerNumber: number | null = null;
  let titleTag: string | null = null;
  let bankName: string | null = null;
  let ownerTag: string | null = null;
  let hadCityOwner = false;
  let level: number | null = null;
  let currentDepositValue: number | null = null;
  let depositCapacity: number | null = null;
  let firstCaptureDate: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) continue;

    if (firstCaptureDate == null) {
      const date = parseFirstCaptureDate(line);
      if (date) firstCaptureDate = date;
    }

    const ownerMatch = line.match(CITY_OWNER_RE);
    if (ownerMatch) {
      const server = Number(ownerMatch[1]);
      if (Number.isFinite(server)) gameServerNumber ??= server;
      ownerTag = ownerMatch[2]!.trim() || null;
      hadCityOwner = true;
    }

    const titleMatch = line.match(TITLE_POSSESSION_RE);
    if (titleMatch) {
      const server = Number(titleMatch[1]);
      if (Number.isFinite(server)) gameServerNumber ??= server;
      titleTag = titleMatch[2]!.trim() || null;
      const name = titleMatch[3]!.trim();
      if (name) bankName = name;
    }

    const levelMatch = line.match(LEVEL_RE);
    if (levelMatch && level == null) {
      const parsed = Number(levelMatch[1]);
      if (Number.isFinite(parsed) && parsed > 0) level = parsed;
    }

    const depositMatch = line.match(DEPOSIT_VALUE_RE);
    if (depositMatch && currentDepositValue == null) {
      currentDepositValue = parseIntAmount(depositMatch[1]!);
      depositCapacity = parseIntAmount(depositMatch[2]!);
    }
  }

  if (
    !hasBankInfoSignal({
      hadCityOwner,
      level,
      currentDepositValue,
      depositCapacity,
      firstCaptureDate,
    })
  ) {
    return null;
  }

  return {
    gameServerNumber,
    owningAllianceTag: ownerTag ?? titleTag,
    bankName,
    level,
    currentDepositValue,
    depositCapacity,
    firstCaptureDate,
  };
}
