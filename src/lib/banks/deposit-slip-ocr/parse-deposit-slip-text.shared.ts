/**
 * Client-safe Deposit Slip History line parsers.
 * Expects OCR text from the in-game "Deposit Slip History" overlay.
 *
 * When Tesseract line bboxes are present (same geometry plumbing as City List
 * word-x matching), field association uses **vertical proximity** so a
 * Deposit/outcome line attaches to the nearest identity above it — not the
 * next identity in OCR reading order. Without bboxes, association falls back
 * to the legacy line-order window.
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

/** Line bbox in processed-image pixel space (from Tesseract blocks). */
export type DepositSlipOcrLineBbox = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

/**
 * OCR line input for parsers. Optional confidence + line bbox enable
 * geometry-aware name↔amount association when present.
 */
export type DepositSlipOcrLine = {
  text: string;
  confidence?: number | null;
  bbox?: DepositSlipOcrLineBbox | null;
};

type NormalizedOcrLine = {
  text: string;
  confidence: number | null;
  /** Vertical center in image pixels; null when bbox missing/invalid. */
  yCenter: number | null;
  rowHeight: number | null;
};

function lineYCenter(bbox: DepositSlipOcrLineBbox | null | undefined): {
  yCenter: number | null;
  rowHeight: number | null;
} {
  if (
    !bbox ||
    typeof bbox.y0 !== "number" ||
    typeof bbox.y1 !== "number" ||
    !Number.isFinite(bbox.y0) ||
    !Number.isFinite(bbox.y1)
  ) {
    return { yCenter: null, rowHeight: null };
  }
  return {
    yCenter: (bbox.y0 + bbox.y1) / 2,
    rowHeight: Math.max(1, bbox.y1 - bbox.y0),
  };
}

function normalizeOcrLines(
  lines: readonly string[] | readonly DepositSlipOcrLine[],
): NormalizedOcrLine[] {
  return lines.map((line) => {
    if (typeof line === "string") {
      return { text: line, confidence: null, yCenter: null, rowHeight: null };
    }
    const confidence =
      typeof line.confidence === "number" && Number.isFinite(line.confidence)
        ? line.confidence
        : null;
    const { yCenter, rowHeight } = lineYCenter(line.bbox);
    return { text: line.text, confidence, yCenter, rowHeight };
  });
}

function meanConfidence(values: readonly (number | null)[]): number | null {
  const present = values.filter(
    (value): value is number => typeof value === "number",
  );
  if (present.length === 0) return null;
  return present.reduce((sum, value) => sum + value, 0) / present.length;
}

function medianPositive(values: readonly number[]): number {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return 36;
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * Max vertical gap (px) from an identity to claim a timestamp / Deposit /
 * outcome line. Scaled from median OCR line height when available.
 */
function maxVerticalFieldGapPx(lines: readonly NormalizedOcrLine[]): number {
  const med = medianPositive(
    lines
      .map((l) => l.rowHeight)
      .filter((h): h is number => typeof h === "number"),
  );
  return Math.max(96, med * 5);
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
 * at `identityIndex` (reading-order path).
 */
function findNearbyDepositSlipTimestamp(
  lines: readonly NormalizedOcrLine[],
  identityIndex: number,
  claimedLineIndexes: ReadonlySet<number>,
): { depositAt: string; confidence: number | null; lineIndex: number } | null {
  for (let k = 1; k <= TIMESTAMP_SEARCH_BACK_LINES; k += 1) {
    const j = identityIndex - k;
    if (j < 0) break;
    if (claimedLineIndexes.has(j)) continue;
    const probe = lines[j]!.text.trim();
    if (parseDepositSlipIdentity(probe)) break;
    if (isDepositSlipRowContentLine(probe)) break;
    const ts = parseDepositSlipTimestamp(probe);
    if (ts) return { depositAt: ts, confidence: lines[j]!.confidence, lineIndex: j };
  }
  for (let k = 1; k <= TIMESTAMP_SEARCH_FORWARD_LINES; k += 1) {
    const j = identityIndex + k;
    if (j >= lines.length) break;
    if (claimedLineIndexes.has(j)) continue;
    const probe = lines[j]!.text.trim();
    if (parseDepositSlipIdentity(probe)) break;
    if (isDepositSlipRowContentLine(probe)) break;
    const ts = parseDepositSlipTimestamp(probe);
    if (ts) return { depositAt: ts, confidence: lines[j]!.confidence, lineIndex: j };
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

type IdentityAnchor = {
  lineIndex: number;
  identity: ParsedDepositSlipIdentity;
  confidence: number | null;
  yCenter: number | null;
};

type DraftBuilder = {
  identity: ParsedDepositSlipIdentity;
  identityConfidence: number | null;
  depositAt: string | null;
  termDays: DepositTermDays | null;
  amount: number | null;
  status: DepositStatus;
  outcomeAmount: number | null;
  outcomeKind: ParsedDepositSlipDraft["outcomeKind"];
  confidenceParts: Array<number | null>;
};

function emptyDraft(anchor: IdentityAnchor): DraftBuilder {
  return {
    identity: anchor.identity,
    identityConfidence: anchor.confidence,
    depositAt: null,
    termDays: null,
    amount: null,
    status: "locked",
    outcomeAmount: null,
    outcomeKind: null,
    confidenceParts: [anchor.confidence],
  };
}

function finalizeDraft(draft: DraftBuilder): ParsedDepositSlipDraft | null {
  if (draft.amount == null && draft.depositAt == null) return null;
  return {
    depositAt: draft.depositAt,
    termDays: draft.termDays,
    amount: draft.amount,
    status: draft.status,
    outcomeAmount: draft.outcomeAmount,
    outcomeKind: draft.outcomeKind,
    identity: draft.identity,
    confidence: meanConfidence(draft.confidenceParts),
  };
}

/**
 * True when enough identities carry line bboxes to prefer vertical
 * association over OCR reading order.
 */
function shouldUseVerticalGeometry(
  anchors: readonly IdentityAnchor[],
  lines: readonly NormalizedOcrLine[],
): boolean {
  const withY = anchors.filter((a) => a.yCenter != null).length;
  if (withY === 0) return false;
  // Need at least one field line with geometry too — otherwise nothing to zip.
  const fieldWithY = lines.some((line) => {
    if (line.yCenter == null) return false;
    const t = line.text.trim();
    return (
      Boolean(parseDepositSlipTimestamp(t)) ||
      DEPOSIT_RE.test(t) ||
      TOTAL_RETURN_RE.test(t) ||
      EARLY_REFUND_RE.test(t)
    );
  });
  return fieldWithY && withY >= Math.ceil(anchors.length / 2);
}

/**
 * Assign each geometric field line to the nearest identity **above** it
 * (same card: timestamp slightly above identity; Deposit/outcome below).
 * Exclusive: one Deposit line → one identity.
 */
function assignFieldsByVerticalProximity(
  anchors: readonly IdentityAnchor[],
  lines: readonly NormalizedOcrLine[],
  drafts: Map<number, DraftBuilder>,
  claimedLineIndexes: Set<number>,
): void {
  const maxGap = maxVerticalFieldGapPx(lines);
  const medH = medianPositive(
    lines
      .map((l) => l.rowHeight)
      .filter((h): h is number => typeof h === "number"),
  );
  // Allow a little OCR y-reorder noise (field slightly above identity).
  const aboveSlack = medH * 0.75;

  const geoAnchors = anchors
    .filter((a): a is IdentityAnchor & { yCenter: number } => a.yCenter != null)
    .slice()
    .sort((a, b) => a.yCenter - b.yCenter);

  type FieldKind = "timestamp" | "deposit" | "outcome";
  type FieldCandidate = {
    lineIndex: number;
    yCenter: number;
    kind: FieldKind;
    confidence: number | null;
    apply: (draft: DraftBuilder) => void;
  };

  const fields: FieldCandidate[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (claimedLineIndexes.has(i)) continue;
    const line = lines[i]!;
    if (line.yCenter == null) continue;
    const probe = line.text.trim();
    if (!probe) continue;
    if (parseDepositSlipIdentity(probe)) continue;

    const ts = parseDepositSlipTimestamp(probe);
    if (ts) {
      fields.push({
        lineIndex: i,
        yCenter: line.yCenter,
        kind: "timestamp",
        confidence: line.confidence,
        apply: (draft) => {
          if (draft.depositAt != null) return;
          draft.depositAt = ts;
          draft.confidenceParts.push(line.confidence);
        },
      });
      continue;
    }

    const depositMatch = probe.match(DEPOSIT_RE);
    if (depositMatch) {
      const amount = parseIntAmount(depositMatch[1]!);
      const termDays = toDepositTermDays(Number(depositMatch[2]));
      fields.push({
        lineIndex: i,
        yCenter: line.yCenter,
        kind: "deposit",
        confidence: line.confidence,
        apply: (draft) => {
          if (draft.amount != null) return;
          draft.amount = amount;
          draft.termDays = termDays;
          draft.confidenceParts.push(line.confidence);
        },
      });
      continue;
    }

    const totalMatch = probe.match(TOTAL_RETURN_RE);
    if (totalMatch) {
      const outcomeAmount = parseIntAmount(totalMatch[1]!);
      fields.push({
        lineIndex: i,
        yCenter: line.yCenter,
        kind: "outcome",
        confidence: line.confidence,
        apply: (draft) => {
          if (draft.outcomeKind != null) return;
          draft.outcomeAmount = outcomeAmount;
          draft.outcomeKind = "total_return";
          draft.status = "matured";
          draft.confidenceParts.push(line.confidence);
        },
      });
      continue;
    }

    const earlyMatch = probe.match(EARLY_REFUND_RE);
    if (earlyMatch) {
      const outcomeAmount = parseIntAmount(earlyMatch[1]!);
      fields.push({
        lineIndex: i,
        yCenter: line.yCenter,
        kind: "outcome",
        confidence: line.confidence,
        apply: (draft) => {
          if (draft.outcomeKind != null) return;
          draft.outcomeAmount = outcomeAmount;
          draft.outcomeKind = "early_termination_refund";
          draft.status = "looted";
          draft.confidenceParts.push(line.confidence);
        },
      });
    }
  }

  // Nearest identity whose y is at or above the field (with small slack).
  const pickIdentity = (
    fieldY: number,
    kind: FieldKind,
  ): (IdentityAnchor & { yCenter: number }) | null => {
    let best: (IdentityAnchor & { yCenter: number }) | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const anchor of geoAnchors) {
      const dy = fieldY - anchor.yCenter;
      if (kind === "timestamp") {
        // Timestamps sit above the identity; allow slight below noise.
        if (dy > aboveSlack) continue;
        if (anchor.yCenter - fieldY > maxGap) continue;
      } else {
        // Deposit / outcome sit below the identity.
        if (dy < -aboveSlack) continue;
        if (dy > maxGap) continue;
      }
      const dist = Math.abs(dy);
      if (dist < bestDist) {
        bestDist = dist;
        best = anchor;
      }
    }
    return best;
  };

  // Process closer field↔identity pairs first so contested lines go to the
  // geometrically nearer commander (not reading-order first-come).
  const scored = fields
    .map((field) => {
      const anchor = pickIdentity(field.yCenter, field.kind);
      if (!anchor) return null;
      return {
        field,
        anchor,
        dist: Math.abs(field.yCenter - anchor.yCenter),
      };
    })
    .filter(
      (
        row,
      ): row is {
        field: FieldCandidate;
        anchor: IdentityAnchor & { yCenter: number };
        dist: number;
      } => row != null,
    )
    .sort((a, b) => a.dist - b.dist || a.field.lineIndex - b.field.lineIndex);

  for (const { field, anchor } of scored) {
    if (claimedLineIndexes.has(field.lineIndex)) continue;
    const draft = drafts.get(anchor.lineIndex);
    if (!draft) continue;

    if (field.kind === "timestamp" && draft.depositAt != null) continue;
    if (field.kind === "deposit" && draft.amount != null) continue;
    if (field.kind === "outcome" && draft.outcomeKind != null) continue;

    field.apply(draft);
    claimedLineIndexes.add(field.lineIndex);
  }
}

/**
 * Legacy reading-order association for identities / fields that geometry
 * could not fill. Only consumes unclaimed lines.
 */
function fillDraftsFromReadingOrder(
  anchors: readonly IdentityAnchor[],
  lines: readonly NormalizedOcrLine[],
  drafts: Map<number, DraftBuilder>,
  claimedLineIndexes: Set<number>,
): void {
  for (const anchor of anchors) {
    const draft = drafts.get(anchor.lineIndex);
    if (!draft) continue;
    const i = anchor.lineIndex;

    if (draft.depositAt == null) {
      const nearbyTimestamp = findNearbyDepositSlipTimestamp(
        lines,
        i,
        claimedLineIndexes,
      );
      if (nearbyTimestamp) {
        draft.depositAt = nearbyTimestamp.depositAt;
        draft.confidenceParts.push(nearbyTimestamp.confidence);
        claimedLineIndexes.add(nearbyTimestamp.lineIndex);
      }
    }

    for (let j = i; j < Math.min(lines.length, i + 5); j += 1) {
      if (j !== i && claimedLineIndexes.has(j)) continue;
      const probe = lines[j]!.text.trim();
      if (j > i && parseDepositSlipIdentity(probe)) break;

      if (draft.amount == null) {
        const depositMatch = probe.match(DEPOSIT_RE);
        if (depositMatch) {
          draft.amount = parseIntAmount(depositMatch[1]!);
          draft.termDays = toDepositTermDays(Number(depositMatch[2]));
          draft.confidenceParts.push(lines[j]!.confidence);
          claimedLineIndexes.add(j);
          continue;
        }
      }

      if (draft.outcomeKind == null) {
        const totalMatch = probe.match(TOTAL_RETURN_RE);
        if (totalMatch) {
          draft.outcomeAmount = parseIntAmount(totalMatch[1]!);
          draft.outcomeKind = "total_return";
          draft.status = "matured";
          draft.confidenceParts.push(lines[j]!.confidence);
          claimedLineIndexes.add(j);
          continue;
        }
        const earlyMatch = probe.match(EARLY_REFUND_RE);
        if (earlyMatch) {
          draft.outcomeAmount = parseIntAmount(earlyMatch[1]!);
          draft.outcomeKind = "early_termination_refund";
          draft.status = "looted";
          draft.confidenceParts.push(lines[j]!.confidence);
          claimedLineIndexes.add(j);
        }
      }
    }
  }
}

/**
 * Parse OCR lines from Deposit Slip History into drafts.
 * Duplicate slips (scroll overlap across frames) should be merged via
 * {@link mergeDepositSlipHistoryParses}.
 *
 * When lines include Tesseract confidence, each draft carries the mean
 * confidence of the identity / timestamp / deposit / outcome lines that
 * contributed to it (used by dedupe pick-best). When lines include line
 * bboxes, Deposit/outcome/timestamp lines attach by vertical proximity
 * before any reading-order fallback.
 */
export function parseDepositSlipHistoryText(
  lines: readonly string[] | readonly DepositSlipOcrLine[],
): ParsedDepositSlipHistory {
  const normalized = normalizeOcrLines(lines);
  const textLines = normalized.map((line) => line.text);
  const depositPolicy = parseDepositPolicyFromHeader(textLines);
  const minimumDeposit = parseMinimumDeposit(textLines);

  const anchors: IdentityAnchor[] = [];
  for (let i = 0; i < normalized.length; i += 1) {
    const line = normalized[i]!.text.trim();
    if (!line) continue;
    const identity = parseDepositSlipIdentity(line);
    if (!identity) continue;
    anchors.push({
      lineIndex: i,
      identity,
      confidence: normalized[i]!.confidence,
      yCenter: normalized[i]!.yCenter,
    });
  }

  const drafts = new Map<number, DraftBuilder>();
  for (const anchor of anchors) {
    drafts.set(anchor.lineIndex, emptyDraft(anchor));
  }

  const claimedLineIndexes = new Set<number>();
  for (const anchor of anchors) {
    claimedLineIndexes.add(anchor.lineIndex);
  }

  if (shouldUseVerticalGeometry(anchors, normalized)) {
    assignFieldsByVerticalProximity(
      anchors,
      normalized,
      drafts,
      claimedLineIndexes,
    );
  }

  fillDraftsFromReadingOrder(anchors, normalized, drafts, claimedLineIndexes);

  const slips: ParsedDepositSlipDraft[] = [];
  for (const anchor of anchors) {
    const draft = drafts.get(anchor.lineIndex);
    if (!draft) continue;
    const finalized = finalizeDraft(draft);
    if (finalized) slips.push(finalized);
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
