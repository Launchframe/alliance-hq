/**
 * Client-safe Deposit Slip History line parsers.
 * Expects OCR text from the in-game "Deposit Slip History" overlay.
 *
 * When Tesseract line bboxes are present (same geometry plumbing as City List
 * word-x matching), field association uses **midpoint y-bands** between
 * identity centers so a Deposit/outcome/timestamp line attaches to the card
 * that owns its vertical band — not the next identity in OCR reading order.
 * Without complete identity bboxes, association falls back to the legacy
 * line-order window.
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
  isDepositSlipOutcomeProbe,
  isDepositSlipRowContentProbe,
  parseDepositSlipDepositLine,
  parseDepositSlipOutcomeLine,
} from "@/lib/banks/deposit-slip-ocr/deposit-slip-outcome-parse.shared";
import {
  buildDepositSlipUtcIso,
  inferMissingDepositSlipTimestamps,
  repairInvalidDepositSlipDates,
  resolveDepositSlipSeasonYear,
  roundDepositSlipUtcToHour,
} from "@/lib/banks/deposit-slip-ocr/deposit-slip-infer-missing-timestamps.shared";
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
  /**
   * OCR recovered a plausible time-of-day but month/day were invalid. Cleared
   * after {@link repairInvalidDepositSlipDates} borrows YYYY-MM-DD from
   * neighboring frames during merge.
   */
  depositAtTimePendingDate?: DepositSlipTimePendingDate | null;
};

export type DepositSlipTimestampRound = "ten_minutes" | "hour" | "none";

/** Wall-clock components when OCR date digits are out of range. */
export type DepositSlipTimePendingDate = {
  hour: number;
  minute: number;
  second: number;
  round: DepositSlipTimestampRound;
};

export type DepositSlipTimestampParts =
  | { kind: "valid"; iso: string }
  | {
      kind: "invalid_date";
      hour: number;
      minute: number;
      second: number;
      round: DepositSlipTimestampRound;
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
const TIMESTAMP_NO_SECONDS_RE =
  /(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})\b/;
const TIMESTAMP_HOUR_ONLY_RE =
  /(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2})\b/;
const TIMESTAMP_DATE_ONLY_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const TIMESTAMP_MONTH_DAY_RE =
  /(?:^|\s)(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\b/;

const IDENTITY_RE = /#(\d{3,5})\s*\[\s*([^\]]+?)\s*\]\s*(.+?)\s*$/;

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
  return isDepositSlipRowContentProbe(probe);
}

function applyOutcomeToDraft(
  draft: DraftBuilder,
  outcome: NonNullable<ReturnType<typeof parseDepositSlipOutcomeLine>>,
  confidence: number | null,
): void {
  if (draft.outcomeKind != null) return;
  draft.outcomeAmount = outcome.amount;
  draft.outcomeKind = outcome.kind;
  draft.status = outcome.kind === "total_return" ? "matured" : "looted";
  draft.confidenceParts.push(confidence);
}

function promoteDraftStatusFromOutcome(draft: DraftBuilder): void {
  if (draft.outcomeKind == null || draft.status !== "locked") return;
  draft.status =
    draft.outcomeKind === "total_return" ? "matured" : "looted";
}

/**
 * Find the timestamp line for the deposit-slip row whose identity line is
 * at `identityIndex` (reading-order path).
 */
function isValidDepositSlipCalendarDate(
  year: number,
  month: number,
  day: number,
): boolean {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return false;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00.000Z`;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return false;
  const parsed = new Date(ms);
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() + 1 === month &&
    parsed.getUTCDate() === day
  );
}

function isValidDepositSlipTimeOfDay(
  hour: number,
  minute: number,
  second: number,
): boolean {
  return (
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59 &&
    second >= 0 &&
    second <= 59
  );
}

function depositSlipTimestampPartsFromYmdHms(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  round: DepositSlipTimestampRound,
): DepositSlipTimestampParts | null {
  if (!isValidDepositSlipTimeOfDay(hour, minute, second)) return null;
  if (isValidDepositSlipCalendarDate(year, month, day)) {
    const iso = buildDepositSlipUtcIso(
      year,
      month,
      day,
      hour,
      minute,
      second,
      round,
    );
    return iso ? { kind: "valid", iso } : null;
  }
  return { kind: "invalid_date", hour, minute, second, round };
}

type NearbyDepositSlipTimestamp = {
  confidence: number | null;
  lineIndex: number;
  parts: DepositSlipTimestampParts;
};

function findNearbyDepositSlipTimestamp(
  lines: readonly NormalizedOcrLine[],
  identityIndex: number,
  claimedLineIndexes: ReadonlySet<number>,
  seasonYear?: number | null,
): NearbyDepositSlipTimestamp | null {
  for (let k = 1; k <= TIMESTAMP_SEARCH_BACK_LINES; k += 1) {
    const j = identityIndex - k;
    if (j < 0) break;
    const probe = lines[j]!.text.trim();
    if (parseDepositSlipIdentity(probe)) break;
    if (isDepositSlipRowContentLine(probe)) break;
    if (claimedLineIndexes.has(j)) continue;
    const parts = parseDepositSlipTimestampParts(probe, seasonYear);
    if (parts) {
      return { parts, confidence: lines[j]!.confidence, lineIndex: j };
    }
  }
  for (let k = 1; k <= TIMESTAMP_SEARCH_FORWARD_LINES; k += 1) {
    const j = identityIndex + k;
    if (j >= lines.length) break;
    const probe = lines[j]!.text.trim();
    if (parseDepositSlipIdentity(probe)) break;
    if (isDepositSlipRowContentLine(probe)) break;
    if (claimedLineIndexes.has(j)) continue;
    const parts = parseDepositSlipTimestampParts(probe, seasonYear);
    if (parts) {
      return { parts, confidence: lines[j]!.confidence, lineIndex: j };
    }
  }
  return null;
}

function applyDepositSlipTimestampPartsToDraft(
  draft: DraftBuilder,
  parts: DepositSlipTimestampParts,
  confidence: number | null,
): boolean {
  if (draft.depositAt != null || draft.depositAtTimePendingDate != null) {
    return false;
  }
  if (parts.kind === "valid") {
    draft.depositAt = parts.iso;
    draft.confidenceParts.push(confidence);
    return true;
  }
  draft.depositAtTimePendingDate = {
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
    round: parts.round,
  };
  draft.confidenceParts.push(confidence);
  return true;
}

/** True when OCR text looks like a deposit-slip timestamp (including bad dates). */
export function isDepositSlipTimestampProbe(
  raw: string,
  seasonYear?: number | null,
): boolean {
  return parseDepositSlipTimestampParts(raw, seasonYear) != null;
}

/**
 * Low-level timestamp parse: returns a valid ISO, or time-only salvage when
 * month/day are out of range but hour/minute/second look plausible.
 */
export function parseDepositSlipTimestampParts(
  raw: string,
  seasonYear?: number | null,
): DepositSlipTimestampParts | null {
  const match = raw.match(TIMESTAMP_RE);
  if (match) {
    const [, y, mo, d, h, mi, s] = match;
    return depositSlipTimestampPartsFromYmdHms(
      Number(y),
      Number(mo),
      Number(d),
      Number(h),
      Number(mi),
      Number(s),
      "none",
    );
  }

  const noSeconds = raw.match(TIMESTAMP_NO_SECONDS_RE);
  if (noSeconds) {
    const [, y, mo, d, h, mi] = noSeconds;
    return depositSlipTimestampPartsFromYmdHms(
      Number(y),
      Number(mo),
      Number(d),
      Number(h),
      Number(mi),
      0,
      "ten_minutes",
    );
  }

  const hourOnly = raw.match(TIMESTAMP_HOUR_ONLY_RE);
  if (hourOnly) {
    const [, y, mo, d, h] = hourOnly;
    const parts = depositSlipTimestampPartsFromYmdHms(
      Number(y),
      Number(mo),
      Number(d),
      Number(h),
      0,
      0,
      "hour",
    );
    if (parts?.kind === "valid") {
      return { kind: "valid", iso: roundDepositSlipUtcToHour(parts.iso) };
    }
    return parts;
  }

  const dateOnly = raw.trim().match(TIMESTAMP_DATE_ONLY_RE);
  if (dateOnly) {
    const [, y, mo, d] = dateOnly;
    if (!isValidDepositSlipCalendarDate(Number(y), Number(mo), Number(d))) {
      return null;
    }
    const iso = buildDepositSlipUtcIso(
      Number(y),
      Number(mo),
      Number(d),
      0,
      0,
      0,
      "hour",
    );
    return iso ? { kind: "valid", iso } : null;
  }

  if (seasonYear != null) {
    const monthDay = raw.match(TIMESTAMP_MONTH_DAY_RE);
    if (monthDay) {
      const [, mo, d, h, mi, s] = monthDay;
      return depositSlipTimestampPartsFromYmdHms(
        seasonYear,
        Number(mo),
        Number(d),
        Number(h),
        Number(mi),
        s ? Number(s) : 0,
        "ten_minutes",
      );
    }
  }

  return null;
}

/** Game timestamps are wall-clock without TZ; treat as UTC for storage. */
export function parseDepositSlipTimestamp(
  raw: string,
  seasonYear?: number | null,
): string | null {
  const parts = parseDepositSlipTimestampParts(raw, seasonYear);
  return parts?.kind === "valid" ? parts.iso : null;
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
  depositAtTimePendingDate: DepositSlipTimePendingDate | null;
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
    depositAtTimePendingDate: null,
    termDays: null,
    amount: null,
    status: "locked",
    outcomeAmount: null,
    outcomeKind: null,
    confidenceParts: [anchor.confidence],
  };
}

function finalizeDraft(draft: DraftBuilder): ParsedDepositSlipDraft | null {
  promoteDraftStatusFromOutcome(draft);
  if (
    draft.amount == null &&
    draft.depositAt == null &&
    draft.depositAtTimePendingDate == null &&
    draft.outcomeKind == null
  ) {
    return null;
  }
  return {
    depositAt: draft.depositAt,
    depositAtTimePendingDate: draft.depositAtTimePendingDate ?? undefined,
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
 * True when every identity carries a **distinct** line bbox and at least one
 * field line does too — otherwise prefer full reading-order. Partial geometry
 * can steal fields onto the subset of geo anchors; identical yCenters collapse
 * midpoint bands to zero width (City List `hasDistinctCenters` analog).
 */
function shouldUseVerticalGeometry(
  anchors: readonly IdentityAnchor[],
  lines: readonly NormalizedOcrLine[],
): boolean {
  if (anchors.length === 0) return false;
  if (anchors.some((a) => a.yCenter == null)) return false;
  const centers = anchors.map((a) => a.yCenter as number);
  if (new Set(centers).size !== centers.length) return false;
  // Need at least one field line with geometry too — otherwise nothing to zip.
  return lines.some((line) => {
    if (line.yCenter == null) return false;
    const t = line.text.trim();
    return (
      isDepositSlipTimestampProbe(t) ||
      isDepositSlipRowContentProbe(t)
    );
  });
}

type GeoIdentityAnchor = IdentityAnchor & { yCenter: number };

/**
 * Identity that owns `fieldY` via midpoint y-bands between sorted identity
 * centers (City List half-pitch analog on the vertical axis). First/last
 * bands extend to ±∞ but still require `maxGap` to the owner.
 */
function identityForYBand(
  fieldY: number,
  geoAnchors: readonly GeoIdentityAnchor[],
  maxGap: number,
): GeoIdentityAnchor | null {
  if (geoAnchors.length === 0) return null;
  if (geoAnchors.length === 1) {
    const only = geoAnchors[0]!;
    return Math.abs(fieldY - only.yCenter) <= maxGap ? only : null;
  }

  for (let i = 0; i < geoAnchors.length; i += 1) {
    const anchor = geoAnchors[i]!;
    const lower =
      i === 0
        ? Number.NEGATIVE_INFINITY
        : (geoAnchors[i - 1]!.yCenter + anchor.yCenter) / 2;
    const upper =
      i === geoAnchors.length - 1
        ? Number.POSITIVE_INFINITY
        : (anchor.yCenter + geoAnchors[i + 1]!.yCenter) / 2;
    // Half-open on the upper edge so the midpoint belongs to the lower band;
    // the last band is closed on both sides.
    const inBand =
      i === geoAnchors.length - 1
        ? fieldY >= lower && fieldY <= upper
        : fieldY >= lower && fieldY < upper;
    if (!inBand) continue;
    if (Math.abs(fieldY - anchor.yCenter) > maxGap) return null;
    return anchor;
  }
  return null;
}

/**
 * Assign each geometric field line to the identity whose midpoint y-band
 * contains it (timestamp / Deposit / outcome on the same card). Exclusive:
 * one field line → at most one identity; closer pairs win first. When the
 * owner's slot for that kind is already filled, the line is still claimed
 * (orphaned) so reading-order cannot mis-zip it.
 */
function assignFieldsByVerticalProximity(
  anchors: readonly IdentityAnchor[],
  lines: readonly NormalizedOcrLine[],
  drafts: Map<number, DraftBuilder>,
  claimedLineIndexes: Set<number>,
): void {
  const maxGap = maxVerticalFieldGapPx(lines);

  const geoAnchors = anchors
    .filter((a): a is GeoIdentityAnchor => a.yCenter != null)
    .slice()
    .sort((a, b) => a.yCenter - b.yCenter || a.lineIndex - b.lineIndex);

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

    const tsParts = parseDepositSlipTimestampParts(probe);
    if (tsParts) {
      fields.push({
        lineIndex: i,
        yCenter: line.yCenter,
        kind: "timestamp",
        confidence: line.confidence,
        apply: (draft) => {
          applyDepositSlipTimestampPartsToDraft(draft, tsParts, line.confidence);
        },
      });
      continue;
    }

    const outcome = parseDepositSlipOutcomeLine(probe);
    if (outcome) {
      fields.push({
        lineIndex: i,
        yCenter: line.yCenter,
        kind: "outcome",
        confidence: line.confidence,
        apply: (draft) => applyOutcomeToDraft(draft, outcome, line.confidence),
      });
      continue;
    }

    const depositLine = parseDepositSlipDepositLine(probe);
    if (depositLine) {
      const termDays = depositLine.termDays
        ? toDepositTermDays(depositLine.termDays)
        : null;
      fields.push({
        lineIndex: i,
        yCenter: line.yCenter,
        kind: "deposit",
        confidence: line.confidence,
        apply: (draft) => {
          if (draft.amount != null) return;
          draft.amount = depositLine.amount;
          draft.termDays = termDays;
          draft.confidenceParts.push(line.confidence);
        },
      });
    }
  }

  // Process closer field↔identity pairs first so contested lines go to the
  // geometrically nearer commander (not reading-order first-come).
  const scored = fields
    .map((field) => {
      const anchor = identityForYBand(field.yCenter, geoAnchors, maxGap);
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
        anchor: GeoIdentityAnchor;
        dist: number;
      } => row != null,
    )
    .sort((a, b) => a.dist - b.dist || a.field.lineIndex - b.field.lineIndex);

  for (const { field, anchor } of scored) {
    if (claimedLineIndexes.has(field.lineIndex)) continue;
    const draft = drafts.get(anchor.lineIndex);
    if (!draft) continue;

    const slotFull =
      (field.kind === "timestamp" &&
        (draft.depositAt != null || draft.depositAtTimePendingDate != null)) ||
      (field.kind === "deposit" && draft.amount != null) ||
      (field.kind === "outcome" && draft.outcomeKind != null);
    if (!slotFull) {
      field.apply(draft);
    }
    // Always claim: geometry decided this line belongs to this band. Leaving
    // it unclaimed lets reading-order steal it across rows.
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

    if (draft.depositAt == null && draft.depositAtTimePendingDate == null) {
      const nearbyTimestamp = findNearbyDepositSlipTimestamp(
        lines,
        i,
        claimedLineIndexes,
      );
      if (nearbyTimestamp) {
        applyDepositSlipTimestampPartsToDraft(
          draft,
          nearbyTimestamp.parts,
          nearbyTimestamp.confidence,
        );
        claimedLineIndexes.add(nearbyTimestamp.lineIndex);
      }
    }

    for (let j = i; j < Math.min(lines.length, i + 5); j += 1) {
      const probe = lines[j]!.text.trim();
      // Identity boundary before claimed-skip: next-row identities are always
      // pre-claimed, so checking claimed first would scan into their fields.
      if (j > i && parseDepositSlipIdentity(probe)) break;
      if (j !== i && claimedLineIndexes.has(j)) continue;

      if (draft.outcomeKind == null) {
        const outcome = parseDepositSlipOutcomeLine(probe);
        if (outcome) {
          applyOutcomeToDraft(draft, outcome, lines[j]!.confidence);
          claimedLineIndexes.add(j);
          continue;
        }
      }

      if (draft.amount == null && !isDepositSlipOutcomeProbe(probe)) {
        const depositLine = parseDepositSlipDepositLine(probe);
        if (depositLine) {
          draft.amount = depositLine.amount;
          draft.termDays = depositLine.termDays
            ? toDepositTermDays(depositLine.termDays)
            : null;
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
 * contributed to it (used by dedupe pick-best). When every identity line
 * includes a line bbox (plus at least one field bbox), Deposit/outcome/
 * timestamp lines attach by midpoint y-bands before any reading-order
 * fallback.
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

  const seasonYear = resolveDepositSlipSeasonYear(
    [...drafts.values()].map((draft) => ({ depositAt: draft.depositAt })),
    new Date(),
  );
  if (seasonYear != null) {
    for (const anchor of anchors) {
      const draft = drafts.get(anchor.lineIndex);
      if (
        !draft ||
        draft.depositAt != null ||
        draft.depositAtTimePendingDate != null
      ) {
        continue;
      }
      const nearbyTimestamp = findNearbyDepositSlipTimestamp(
        normalized,
        anchor.lineIndex,
        claimedLineIndexes,
        seasonYear,
      );
      if (nearbyTimestamp) {
        applyDepositSlipTimestampPartsToDraft(
          draft,
          nearbyTimestamp.parts,
          nearbyTimestamp.confidence,
        );
        claimedLineIndexes.add(nearbyTimestamp.lineIndex);
      }
    }
  }

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

  repairInvalidDepositSlipDates(slips);
  inferMissingDepositSlipTimestamps(slips);
  for (const slip of slips) {
    if (slip.depositAt != null) {
      delete slip.depositAtTimePendingDate;
    }
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
