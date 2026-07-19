/**
 * Client-safe Deposit Slip History line parsers.
 * Expects OCR text from the in-game "Deposit Slip History" overlay.
 */

import type {
  DepositPolicy,
  DepositStatus,
  DepositTermDays,
} from "@/lib/banks/types.shared";
import { DEPOSIT_TERMS } from "@/lib/banks/types.shared";
import {
  dedupeDepositSlips,
  type DedupedDepositSlip,
} from "@/lib/banks/deposit-slip-ocr/deposit-slip-dedupe.shared";
import {
  emptyDedupeReport,
  type DedupeReport,
} from "@/lib/video/dedupe/merge-report.shared";

export const BANK_DEPOSIT_SLIP_HISTORY_SCORE_TARGET =
  "bank-deposit-slip-history" as const;

export type ParsedDepositSlipIdentity = {
  gameServerNumber: number | null;
  allianceTag: string | null;
  commanderName: string;
  /** Full OCR identity line, e.g. `#1211[Roar]snapz a saurus`. */
  rawIdentity: string;
};

export type ParsedDepositSlipDraft = {
  depositAt: string | null;
  termDays: DepositTermDays | null;
  amount: number | null;
  status: DepositStatus;
  outcomeAmount: number | null;
  outcomeKind: "total_return" | "early_termination_refund" | null;
  /**
   * When a locked→matured/looted lifecycle merge keeps both times: deposit
   * initiate in `depositAt`, maturity/loot instant here.
   */
  outcomeAt?: string | null;
  identity: ParsedDepositSlipIdentity;
  /** Source frame index when known (video stitch). */
  sourceFrameIndex?: number;
  /**
   * Mean Tesseract line confidence (0–100) for lines that contributed to this
   * slip, when available. Used by dedupe pick-best as a tiebreaker after
   * completeness.
   */
  confidence?: number | null;
};

/** OCR line input for parsers that optionally carry Tesseract confidence. */
export type DepositSlipOcrLine = {
  text: string;
  confidence?: number | null;
};

function normalizeOcrLines(
  lines: readonly string[] | readonly DepositSlipOcrLine[],
): Array<{ text: string; confidence: number | null }> {
  return lines.map((line) => {
    if (typeof line === "string") {
      return { text: line, confidence: null };
    }
    const confidence =
      typeof line.confidence === "number" && Number.isFinite(line.confidence)
        ? line.confidence
        : null;
    return { text: line.text, confidence };
  });
}

function meanConfidence(values: readonly (number | null)[]): number | null {
  const present = values.filter(
    (value): value is number => typeof value === "number",
  );
  if (present.length === 0) return null;
  return present.reduce((sum, value) => sum + value, 0) / present.length;
}

export type ParsedDepositSlipHistory = {
  depositPolicy: DepositPolicy | null;
  minimumDeposit: number | null;
  slips: ParsedDepositSlipDraft[];
};

export type MergeDepositSlipHistoryResult = {
  history: ParsedDepositSlipHistory & { slips: DedupedDepositSlip[] };
  dedupeReport: DedupeReport;
};

const TIMESTAMP_RE =
  /(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})/;

const IDENTITY_RE = /#(\d{3,5})\s*\[\s*([^\]]+?)\s*\]\s*(.+?)\s*$/;

const DEPOSIT_RE =
  /Deposit:\s*CrystalGold\s*x\s*([\d,]+)\s*,\s*Term:\s*(\d+)\s*day/i;

const TOTAL_RETURN_RE =
  /Total\s+return:\s*CrystalGold\s*x\s*([\d,]+)/i;

const EARLY_REFUND_RE =
  /Early\s+termination\s+refund:\s*CrystalGold\s*x\s*([\d,]+)/i;

const MIN_DEPOSIT_RE =
  /Minimum\s+Deposit\s+for\s+This\s+Bank:\s*([\d,]+)/i;

function parseIntAmount(raw: string): number | null {
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function toDepositTermDays(n: number): DepositTermDays | null {
  return (DEPOSIT_TERMS as readonly number[]).includes(n)
    ? (n as DepositTermDays)
    : null;
}

function slipDedupeKey(slip: ParsedDepositSlipDraft): string {
  return [
    slip.depositAt ?? "",
    slip.identity.rawIdentity,
    slip.amount ?? "",
    slip.termDays ?? "",
    slip.status,
    slip.outcomeKind ?? "",
    slip.outcomeAmount ?? "",
  ].join("|");
}

function dedupeAndSortSlips(
  slips: readonly ParsedDepositSlipDraft[],
): ParsedDepositSlipDraft[] {
  const seen = new Set<string>();
  const unique: ParsedDepositSlipDraft[] = [];
  for (const slip of slips) {
    const key = slipDedupeKey(slip);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(slip);
  }
  unique.sort((a, b) => {
    const aMs = a.depositAt ? Date.parse(a.depositAt) : 0;
    const bMs = b.depositAt ? Date.parse(b.depositAt) : 0;
    return bMs - aMs;
  });
  return unique;
}

/**
 * Max number of lines to look backward/forward from an identity line when
 * hunting for its timestamp. Wider than the nominal 1-line gap so a couple
 * of garbled/hallucinated OCR lines between the timestamp and identity
 * (common on the small gray timestamp text) don't cause a miss.
 */
const TIMESTAMP_SEARCH_BACK_LINES = 6;
const TIMESTAMP_SEARCH_FORWARD_LINES = 2;

/**
 * True when `probe` is clearly another slip's (or this slip's) deposit /
 * outcome content. Used as a hard boundary while hunting timestamps so we
 * never walk past row-owned Deposit/Total-return/Early-refund lines into a
 * neighboring row's timestamp (e.g. identity → Deposit → next timestamp).
 */
function isDepositSlipRowContentLine(probe: string): boolean {
  return (
    DEPOSIT_RE.test(probe) ||
    TOTAL_RETURN_RE.test(probe) ||
    EARLY_REFUND_RE.test(probe)
  );
}

/**
 * Find the timestamp line for the deposit-slip row whose identity line is
 * at `identityIndex`. In the in-game overlay each row is physically
 * `[timestamp, identity, deposit info]`, so the timestamp normally sits
 * immediately before the identity line. Extra noise lines from OCR can
 * shift that offset, so this scans outward from the identity line in
 * proximity order (closest first) rather than a fixed-width window —
 * but stops as soon as it crosses into a neighboring row's identity line
 * *or* a Deposit/outcome content line, so it can never mistakenly borrow
 * a different row's timestamp.
 */
function findNearbyDepositSlipTimestamp(
  lines: readonly { text: string; confidence: number | null }[],
  identityIndex: number,
): { depositAt: string; confidence: number | null } | null {
  for (let k = 1; k <= TIMESTAMP_SEARCH_BACK_LINES; k += 1) {
    const j = identityIndex - k;
    if (j < 0) break;
    const probe = lines[j]!.text.trim();
    if (parseDepositSlipIdentity(probe)) break;
    // Previous row's Deposit/outcome sits between us and its timestamp when
    // the previous identity was garbled — stop rather than steal that ts.
    if (isDepositSlipRowContentLine(probe)) break;
    const ts = parseDepositSlipTimestamp(probe);
    if (ts) return { depositAt: ts, confidence: lines[j]!.confidence };
  }
  for (let k = 1; k <= TIMESTAMP_SEARCH_FORWARD_LINES; k += 1) {
    const j = identityIndex + k;
    if (j >= lines.length) break;
    const probe = lines[j]!.text.trim();
    if (parseDepositSlipIdentity(probe)) break;
    // Do not walk past this row's Deposit/outcome into the next row's
    // timestamp (common when this row's own timestamp was dropped entirely).
    if (isDepositSlipRowContentLine(probe)) break;
    const ts = parseDepositSlipTimestamp(probe);
    if (ts) return { depositAt: ts, confidence: lines[j]!.confidence };
  }
  return null;
}

/** Game timestamps are wall-clock without TZ; treat as UTC for storage. */
export function parseDepositSlipTimestamp(raw: string): string | null {
  const match = raw.match(TIMESTAMP_RE);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const iso = `${y}-${mo!.padStart(2, "0")}-${d!.padStart(2, "0")}T${h!.padStart(2, "0")}:${mi}:${s}.000Z`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export function parseDepositSlipIdentity(
  raw: string,
): ParsedDepositSlipIdentity | null {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  const match = cleaned.match(IDENTITY_RE);
  if (!match) return null;
  const gameServerNumber = Number(match[1]);
  const allianceTag = match[2]!.trim();
  const commanderName = match[3]!.trim();
  if (!commanderName) return null;
  return {
    gameServerNumber: Number.isFinite(gameServerNumber)
      ? gameServerNumber
      : null,
    allianceTag: allianceTag || null,
    commanderName,
    rawIdentity: cleaned,
  };
}

export function parseDepositPolicyFromHeader(
  lines: readonly string[],
): DepositPolicy | null {
  const blob = lines.join(" ").toLowerCase();
  if (
    blob.includes("owning alliance") ||
    blob.includes("open only to the owning")
  ) {
    return "alliance";
  }
  if (blob.includes("same warzone")) {
    return "warzone";
  }
  if (blob.includes("public") || blob.includes("all commanders")) {
    return "public";
  }
  return null;
}

export function parseMinimumDeposit(lines: readonly string[]): number | null {
  for (const line of lines) {
    const match = line.match(MIN_DEPOSIT_RE);
    if (match) return parseIntAmount(match[1]!);
  }
  return null;
}

/**
 * Parse OCR lines from Deposit Slip History into drafts.
 * Duplicate slips (scroll overlap across frames) should be merged via
 * {@link mergeDepositSlipHistoryParses}.
 *
 * When lines include Tesseract confidence, each draft carries the mean
 * confidence of the identity / timestamp / deposit / outcome lines that
 * contributed to it (used by dedupe pick-best).
 */
export function parseDepositSlipHistoryText(
  lines: readonly string[] | readonly DepositSlipOcrLine[],
): ParsedDepositSlipHistory {
  const normalized = normalizeOcrLines(lines);
  const textLines = normalized.map((line) => line.text);
  const depositPolicy = parseDepositPolicyFromHeader(textLines);
  const minimumDeposit = parseMinimumDeposit(textLines);

  const slips: ParsedDepositSlipDraft[] = [];

  // Find identity lines; associate nearby timestamp + deposit/outcome lines.
  for (let i = 0; i < normalized.length; i += 1) {
    const line = normalized[i]!.text.trim();
    if (!line) continue;

    const identity = parseDepositSlipIdentity(line);
    if (!identity) continue;

    const confidenceParts: Array<number | null> = [normalized[i]!.confidence];

    // Timestamp is usually on the line right before this identity — search
    // nearby lines, closest first, without crossing into a neighboring row.
    const nearbyTimestamp = findNearbyDepositSlipTimestamp(normalized, i);
    const depositAt = nearbyTimestamp?.depositAt ?? null;
    if (nearbyTimestamp) {
      confidenceParts.push(nearbyTimestamp.confidence);
    }

    let amount: number | null = null;
    let termDays: DepositTermDays | null = null;
    let status: DepositStatus = "locked";
    let outcomeAmount: number | null = null;
    let outcomeKind: ParsedDepositSlipDraft["outcomeKind"] = null;

    for (let j = i; j < Math.min(normalized.length, i + 5); j += 1) {
      const probe = normalized[j]!.text.trim();
      // Stop if we hit another identity (next slip)
      if (j > i && parseDepositSlipIdentity(probe)) break;

      const depositMatch = probe.match(DEPOSIT_RE);
      if (depositMatch) {
        amount = parseIntAmount(depositMatch[1]!);
        termDays = toDepositTermDays(Number(depositMatch[2]));
        confidenceParts.push(normalized[j]!.confidence);
      }
      const totalMatch = probe.match(TOTAL_RETURN_RE);
      if (totalMatch) {
        outcomeAmount = parseIntAmount(totalMatch[1]!);
        outcomeKind = "total_return";
        status = "matured";
        confidenceParts.push(normalized[j]!.confidence);
      }
      const earlyMatch = probe.match(EARLY_REFUND_RE);
      if (earlyMatch) {
        outcomeAmount = parseIntAmount(earlyMatch[1]!);
        outcomeKind = "early_termination_refund";
        status = "looted";
        confidenceParts.push(normalized[j]!.confidence);
      }
    }

    if (amount == null && depositAt == null) continue;

    slips.push({
      depositAt,
      termDays,
      amount,
      status,
      outcomeAmount,
      outcomeKind,
      identity,
      confidence: meanConfidence(confidenceParts),
    });
  }

  return {
    depositPolicy,
    minimumDeposit,
    slips: dedupeAndSortSlips(slips),
  };
}

/**
 * Merge per-frame parses, then fuzzy-dedupe across frames
 * (commander + to-the-minute timestamp) with an officer-facing report.
 */
export function mergeDepositSlipHistoryParses(
  parts: readonly ParsedDepositSlipHistory[],
): MergeDepositSlipHistoryResult {
  let depositPolicy: DepositPolicy | null = null;
  let minimumDeposit: number | null = null;
  const slips: ParsedDepositSlipDraft[] = [];
  for (const part of parts) {
    depositPolicy ??= part.depositPolicy;
    minimumDeposit ??= part.minimumDeposit;
    slips.push(...part.slips);
  }

  if (slips.length === 0) {
    return {
      history: { depositPolicy, minimumDeposit, slips: [] },
      dedupeReport: emptyDedupeReport(0),
    };
  }

  const { slips: deduped, report } = dedupeDepositSlips(slips);
  return {
    history: {
      depositPolicy,
      minimumDeposit,
      slips: deduped,
    },
    dedupeReport: report,
  };
}
