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

const DEPOSIT_STRICT_RE =
  /Deposit:\s*CrystalGold\s*x\s*([\d,]+)\s*,\s*Term:\s*(\d+)\s*day/i;

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

/** Deposit initiate line — skipped when probe is already an outcome line. */
export function parseDepositSlipDepositLine(
  probe: string,
): { amount: number | null; termDays: number | null } | null {
  if (isDepositSlipOutcomeProbe(probe)) return null;
  const match = probe.trim().match(DEPOSIT_STRICT_RE);
  if (!match) return null;
  return {
    amount: parseIntAmount(match[1]!),
    termDays: Number(match[2]),
  };
}

export function isDepositSlipRowContentProbe(probe: string): boolean {
  const trimmed = probe.trim();
  if (!trimmed) return false;
  return (
    Boolean(parseDepositSlipOutcomeLine(trimmed)) ||
    DEPOSIT_STRICT_RE.test(trimmed)
  );
}
