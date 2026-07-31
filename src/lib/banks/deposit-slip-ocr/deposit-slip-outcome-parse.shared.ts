/**
 * Tolerant parsers for deposit-slip terminal outcome lines (green/orange rows).
 * Strict regexes miss common Tesseract garbling; prefer false negatives.
 */

export type DepositSlipOutcomeKind =
  | "total_return"
  | "early_termination_refund";

export type ParsedDepositSlipOutcomeLine = {
  kind: DepositSlipOutcomeKind;
  amount: number | null;
};

const TOTAL_RETURN_STRICT_RE =
  /Total\s+return:\s*CrystalGold\s*x\s*([\d,]+)/i;

const EARLY_REFUND_STRICT_RE =
  /Early\s+termination\s+refund:\s*CrystalGold\s*x\s*([\d,]+)/i;

/**
 * Tolerant "Deposit:" keyword — Tesseract commonly misreads D/O and e/a in this
 * word (observed: "Oepasit:", "Oeposit:", "Depasit:"). Char classes cover the
 * observed confusions without matching unrelated words.
 */
const DEPOSIT_KEYWORD_RE = /[doq][ea]p[oa][s5][i1l]t\s*:/i;

/**
 * Tolerant "CrystalGold" — covers the observed "CrystalGald" (o→a) alongside
 * the existing o/0 and l/1 confusions already handled for outcome lines.
 */
const CRYSTALGOLD_TOLERANT_RE = /crystal\s*g[oa0][l1]d/i;

/**
 * Amount token right after the "x" separator, up to the Deposit/Term divider.
 * Deliberately requires the token to be *all* digits/commas immediately after
 * "x" — a partially-garbled token (e.g. "BODO", "BO00") intentionally fails
 * here rather than guessing digits from letters; see file header.
 */
const AMOUNT_AFTER_X_RE = /\bx\s*([\d,]+)\s*[,.]?\s*Term/i;

/** Term-days is almost always clean OCR even when the amount/keyword garble. */
const TERM_DAYS_RE = /Term:\s*(\d+)\s*day/i;

function parseIntAmount(raw: string): number | null {
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function normalizeOcrProbe(probe: string): string {
  return probe
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/crystal\s*g[o0]ld/g, "crystalgold");
}

function extractCrystalGoldAmount(normalized: string): number | null {
  const match =
    normalized.match(/crystalgold\s*x\s*([\d,]+)/) ??
    normalized.match(/\bx\s*([\d,]+)/);
  return match ? parseIntAmount(match[1]!) : null;
}

/** True when the line is a terminal outcome, not a blue deposit initiate. */
export function isDepositSlipOutcomeProbe(probe: string): boolean {
  return parseDepositSlipOutcomeLine(probe) != null;
}

export function parseDepositSlipOutcomeLine(
  probe: string,
): ParsedDepositSlipOutcomeLine | null {
  const trimmed = probe.trim();
  if (!trimmed) return null;

  const strictTotal = trimmed.match(TOTAL_RETURN_STRICT_RE);
  if (strictTotal) {
    return {
      kind: "total_return",
      amount: parseIntAmount(strictTotal[1]!),
    };
  }

  const strictEarly = trimmed.match(EARLY_REFUND_STRICT_RE);
  if (strictEarly) {
    return {
      kind: "early_termination_refund",
      amount: parseIntAmount(strictEarly[1]!),
    };
  }

  const normalized = normalizeOcrProbe(trimmed);
  const amount = extractCrystalGoldAmount(normalized);

  if (/total\s+return/.test(normalized)) {
    return { kind: "total_return", amount };
  }

  const hasRefund = /refund/.test(normalized);
  const hasEarlyTerm =
    /early\s+term/.test(normalized) ||
    /termination\s+refund/.test(normalized) ||
    /early\s+refund/.test(normalized);
  if (hasRefund && hasEarlyTerm) {
    return { kind: "early_termination_refund", amount };
  }

  return null;
}

/** True when the probe reads as a deposit-initiate line, tolerant of Tesseract
 * garbling in the "Deposit"/"CrystalGold" keywords and punctuation. */
function isDepositSlipDepositLineProbe(trimmed: string): boolean {
  return (
    DEPOSIT_KEYWORD_RE.test(trimmed) && CRYSTALGOLD_TOLERANT_RE.test(trimmed)
  );
}

/**
 * Deposit initiate line — skipped when probe is already an outcome line.
 *
 * Amount and term-days are extracted independently: a garbled amount token
 * (letters where digits belong) must not also null out an otherwise-clean
 * term-days read, and vice versa. Amount only ever comes from a token that is
 * already all digits/commas — see `AMOUNT_AFTER_X_RE`.
 */
export function parseDepositSlipDepositLine(
  probe: string,
): { amount: number | null; termDays: number | null } | null {
  if (isDepositSlipOutcomeProbe(probe)) return null;
  const trimmed = probe.trim();
  if (!isDepositSlipDepositLineProbe(trimmed)) return null;

  const amountMatch = trimmed.match(AMOUNT_AFTER_X_RE);
  const termMatch = trimmed.match(TERM_DAYS_RE);
  if (!amountMatch && !termMatch) return null;

  return {
    amount: amountMatch ? parseIntAmount(amountMatch[1]!) : null,
    termDays: termMatch ? Number(termMatch[1]!) : null,
  };
}

export function isDepositSlipRowContentProbe(probe: string): boolean {
  const trimmed = probe.trim();
  if (!trimmed) return false;
  return (
    Boolean(parseDepositSlipOutcomeLine(trimmed)) ||
    isDepositSlipDepositLineProbe(trimmed)
  );
}
