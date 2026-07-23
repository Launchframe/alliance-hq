/**
 * Compare deposit-slip OCR output between two pipelines — the production
 * per-frame-parse-then-merge path (primary, "submitted" — see below) and the
 * row-fingerprint shadow pass (`row-fingerprint.shared.ts` +
 * `process-deposit-slip-fingerprint-shadow-job.ts`).
 *
 * "Submitted" primary here specifically means the reviewer-approved rows
 * persisted at submit time (`parsed_rows` for the primary job's parse
 * session, non-deleted, after the officer's edits) — not the raw OCR draft.
 * That is the only meaningful ground truth for this comparison: officers
 * fix OCR mistakes, delete noise rows, and merge duplicates during review,
 * so comparing the shadow pass against the pre-review draft would conflate
 * "shadow pipeline disagrees with primary OCR" with "officer edited the row".
 *
 * Deposit-slip rows don't have a single natural identity key the way roster
 * rows do (one row per commander) — a commander can appear on many rows,
 * one per deposit. Rows are matched primary↔shadow by commander-name
 * similarity *and* `depositAt` proximity together (see `matchDepositSlipRows`).
 */

import { normalizeEntityName } from "@/lib/video/dedupe/fuzzy-name-cluster.shared";
import { stringSimilarity } from "@/lib/video/member-matcher";

export type DepositSlipCompareRow = {
  commanderName: string;
  /** ISO timestamp, or `null` when OCR never recovered it (the metric this shadow pass targets). */
  depositAt: string | null;
  termDays: number | null;
  amount: number | null;
  status: string | null;
};

export type DepositSlipTesseractEvalMetrics = {
  primaryRowCount: number;
  shadowRowCount: number;
  rowCountDelta: number;
  matchedRowCount: number;
  onlyInPrimary: number;
  onlyInShadow: number;
  /** Fraction of primary rows matched by a shadow row (row-identity recall). */
  rowRecall: number;
  /** Fraction of shadow rows matched by a primary row (row-identity precision). */
  rowPrecision: number;
  /** Among matched rows where both sides have a depositAt, fraction that agree exactly. */
  depositAtAgreement: number | null;
  /** Fraction of primary rows missing depositAt entirely (the "timestamp miss rate"). */
  primaryMissingDepositAtRate: number;
  /** Same, for shadow rows — the number this shadow pass is meant to improve. */
  shadowMissingDepositAtRate: number;
  amountAgreement: number | null;
  termDaysAgreement: number | null;
  statusAgreement: number | null;
};

export type DepositSlipFingerprintShadowComparison = {
  kind: "deposit_slip_fingerprint_shadow";
  computedAt: string;
  primaryJobId: string;
  shadowJobId: string;
  metrics: DepositSlipTesseractEvalMetrics;
  shadowTotalMs: number | null;
  rawLineCount: number | null;
  uniqueLineCount: number | null;
};

const NAME_MATCH_THRESHOLD = 0.6;
/** Deposit timestamps are minute-precision in-game; allow a little OCR/parse slop. */
const DEPOSIT_AT_MATCH_TOLERANCE_MS = 5 * 60 * 1000;

function parseDepositAtMs(value: string | null): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function nameSimilarity(a: string, b: string): number {
  const left = normalizeEntityName(a);
  const right = normalizeEntityName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  return stringSimilarity(left, right);
}

type RowMatch = {
  primaryIdx: number;
  shadowIdx: number;
  score: number;
};

/**
 * Greedy best-first matching: candidate pairs need name similarity above
 * threshold; when both rows have a depositAt, they must also be within
 * {@link DEPOSIT_AT_MATCH_TOLERANCE_MS} of each other. Rows lacking a
 * depositAt on either (or both) sides can still match on name alone — this
 * is deliberate, since recovering a previously-missing depositAt is exactly
 * what this shadow pass is measured on; requiring depositAt agreement to
 * even consider a match would make `depositAtAgreement` and
 * `shadowMissingDepositAtRate` circular.
 */
export function matchDepositSlipRows(
  primary: readonly DepositSlipCompareRow[],
  shadow: readonly DepositSlipCompareRow[],
  minNameSimilarity = NAME_MATCH_THRESHOLD,
): RowMatch[] {
  const candidates: RowMatch[] = [];

  for (let primaryIdx = 0; primaryIdx < primary.length; primaryIdx++) {
    const p = primary[primaryIdx]!;
    const pAt = parseDepositAtMs(p.depositAt);
    for (let shadowIdx = 0; shadowIdx < shadow.length; shadowIdx++) {
      const s = shadow[shadowIdx]!;
      const similarity = nameSimilarity(p.commanderName, s.commanderName);
      if (similarity < minNameSimilarity) continue;

      const sAt = parseDepositAtMs(s.depositAt);
      if (pAt != null && sAt != null) {
        const gap = Math.abs(pAt - sAt);
        if (gap > DEPOSIT_AT_MATCH_TOLERANCE_MS) continue;
        // Fold timestamp proximity into the score so a closer-in-time match
        // outranks a farther one at similar name similarity.
        const proximityBonus = 1 - gap / DEPOSIT_AT_MATCH_TOLERANCE_MS;
        candidates.push({
          primaryIdx,
          shadowIdx,
          score: similarity + proximityBonus,
        });
        continue;
      }

      candidates.push({ primaryIdx, shadowIdx, score: similarity });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const usedPrimary = new Set<number>();
  const usedShadow = new Set<number>();
  const matches: RowMatch[] = [];

  for (const candidate of candidates) {
    if (usedPrimary.has(candidate.primaryIdx) || usedShadow.has(candidate.shadowIdx)) {
      continue;
    }
    usedPrimary.add(candidate.primaryIdx);
    usedShadow.add(candidate.shadowIdx);
    matches.push(candidate);
  }

  return matches;
}

function agreementRate(
  matches: readonly RowMatch[],
  primary: readonly DepositSlipCompareRow[],
  shadow: readonly DepositSlipCompareRow[],
  hasValue: (row: DepositSlipCompareRow) => boolean,
  agrees: (left: DepositSlipCompareRow, right: DepositSlipCompareRow) => boolean,
): number | null {
  let comparable = 0;
  let agreed = 0;
  for (const match of matches) {
    const left = primary[match.primaryIdx]!;
    const right = shadow[match.shadowIdx]!;
    if (!hasValue(left) || !hasValue(right)) continue;
    comparable++;
    if (agrees(left, right)) agreed++;
  }
  return comparable > 0 ? agreed / comparable : null;
}

function missingRate(
  rows: readonly DepositSlipCompareRow[],
  isMissing: (row: DepositSlipCompareRow) => boolean,
): number {
  if (rows.length === 0) return 0;
  return rows.filter(isMissing).length / rows.length;
}

export function compareDepositSlipOcrQuality(
  primary: readonly DepositSlipCompareRow[],
  shadow: readonly DepositSlipCompareRow[],
): DepositSlipTesseractEvalMetrics {
  const matches = matchDepositSlipRows(primary, shadow);
  const matchedRowCount = matches.length;
  const primaryRowCount = primary.length;
  const shadowRowCount = shadow.length;

  return {
    primaryRowCount,
    shadowRowCount,
    rowCountDelta: Math.abs(primaryRowCount - shadowRowCount),
    matchedRowCount,
    onlyInPrimary: primaryRowCount - matchedRowCount,
    onlyInShadow: shadowRowCount - matchedRowCount,
    rowRecall: primaryRowCount > 0 ? matchedRowCount / primaryRowCount : 0,
    rowPrecision: shadowRowCount > 0 ? matchedRowCount / shadowRowCount : 0,
    depositAtAgreement: agreementRate(
      matches,
      primary,
      shadow,
      (row) => row.depositAt != null,
      (left, right) => left.depositAt === right.depositAt,
    ),
    primaryMissingDepositAtRate: missingRate(primary, (row) => row.depositAt == null),
    shadowMissingDepositAtRate: missingRate(shadow, (row) => row.depositAt == null),
    amountAgreement: agreementRate(
      matches,
      primary,
      shadow,
      (row) => row.amount != null,
      (left, right) => left.amount === right.amount,
    ),
    termDaysAgreement: agreementRate(
      matches,
      primary,
      shadow,
      (row) => row.termDays != null,
      (left, right) => left.termDays === right.termDays,
    ),
    statusAgreement: agreementRate(
      matches,
      primary,
      shadow,
      (row) => row.status != null,
      (left, right) => left.status === right.status,
    ),
  };
}

export function isDepositSlipFingerprintShadowComparison(
  value: unknown,
): value is DepositSlipFingerprintShadowComparison {
  return (
    !!value &&
    typeof value === "object" &&
    (value as DepositSlipFingerprintShadowComparison).kind ===
      "deposit_slip_fingerprint_shadow"
  );
}
