/**
 * High-confidence match of a video-review deposit against slips already stored
 * for the same bank. Used so iterative re-uploads append only *new* events
 * instead of duplicating history that HQ already knows about.
 */

import { DEPOSIT_AT_PROXIMITY_MS } from "@/lib/banks/deposit-slip-ocr/deposit-slip-dedupe.shared";
import type { DepositStatus } from "@/lib/banks/types.shared";
import { normalizeEntityName } from "@/lib/video/dedupe/fuzzy-name-cluster.shared";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** OCR slack around exact term maturity (green is termDays after blue). */
const MATURITY_ALIGNMENT_SLACK_MS = 12 * 60 * 60 * 1000;

export type HistoricalDepositSlipIdentity = {
  commanderName: string;
  depositAt: string;
  amount: number;
  termDays: number;
  depositAllianceTag?: string | null;
  status?: DepositStatus;
  /** Terminal-row outcome instant when known (green/orange timestamp). */
  outcomeAt?: string | null;
  /** When set on both sides, roster-linked deposits match without OCR name equality. */
  allianceMemberId?: string | null;
};

function depositAtMs(value: string | Date | null | undefined): number | null {
  if (value == null) return null;
  const ms =
    value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function normalizeTag(tag: string | null | undefined): string | null {
  if (tag == null) return null;
  const trimmed = tag.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

function resolveStatus(
  slip: HistoricalDepositSlipIdentity,
): DepositStatus {
  return slip.status ?? "locked";
}

function incomingOutcomeMs(
  incoming: HistoricalDepositSlipIdentity,
): number | null {
  return depositAtMs(incoming.outcomeAt ?? incoming.depositAt);
}

function existingOutcomeMs(
  existing: HistoricalDepositSlipIdentity,
): number | null {
  return depositAtMs(existing.outcomeAt ?? existing.depositAt);
}

/** Amount, term, and non-conflicting alliance tags — no commander or timestamps. */
export function depositSlipHistoryFinancialCoreMatch(
  incoming: HistoricalDepositSlipIdentity,
  existing: HistoricalDepositSlipIdentity,
): boolean {
  if (incoming.amount !== existing.amount) return false;
  if (incoming.termDays !== existing.termDays) return false;

  const incomingTag = normalizeTag(incoming.depositAllianceTag);
  const existingTag = normalizeTag(existing.depositAllianceTag);
  if (incomingTag && existingTag && incomingTag !== existingTag) {
    return false;
  }
  return true;
}

/** Amount, term, depositAt proximity, and non-conflicting alliance tags. */
export function depositSlipHistoryFinancialMatch(
  incoming: HistoricalDepositSlipIdentity,
  existing: HistoricalDepositSlipIdentity,
  proximityMs: number = DEPOSIT_AT_PROXIMITY_MS,
): boolean {
  if (!depositSlipHistoryFinancialCoreMatch(incoming, existing)) {
    return false;
  }

  const a = depositAtMs(incoming.depositAt);
  const b = depositAtMs(existing.depositAt);
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= proximityMs;
}

function depositSlipHistoryNameCoreMatch(
  incoming: HistoricalDepositSlipIdentity,
  existing: HistoricalDepositSlipIdentity,
): boolean {
  if (
    normalizeEntityName(incoming.commanderName) !==
    normalizeEntityName(existing.commanderName)
  ) {
    return false;
  }
  return depositSlipHistoryFinancialCoreMatch(incoming, existing);
}

function historicalIdentityMatch(
  incoming: HistoricalDepositSlipIdentity,
  existing: HistoricalDepositSlipIdentity,
  proximityMs: number = DEPOSIT_AT_PROXIMITY_MS,
): boolean {
  if (!depositSlipHistoryFinancialCoreMatch(incoming, existing)) {
    return false;
  }
  if (isMemberLinkedHistoricalDepositMatch(incoming, existing, proximityMs)) {
    return true;
  }
  return (
    normalizeEntityName(incoming.commanderName) ===
    normalizeEntityName(existing.commanderName)
  );
}

/**
 * True when `incoming` is a high-confidence duplicate of `existing`:
 * same normalized commander, depositAt within the OCR proximity window,
 * same amount and term, and non-conflicting alliance tags when both set.
 *
 * Status is intentionally excluded — use {@link shouldSkipHistoricalDepositDuplicate}
 * / {@link shouldUpdateHistoricalDepositOutcome} for skip vs outcome-update.
 */
export function isHighConfidenceHistoricalDepositMatch(
  incoming: HistoricalDepositSlipIdentity,
  existing: HistoricalDepositSlipIdentity,
  proximityMs: number = DEPOSIT_AT_PROXIMITY_MS,
): boolean {
  if (!depositSlipHistoryNameCoreMatch(incoming, existing)) {
    return false;
  }

  const a = depositAtMs(incoming.depositAt);
  const b = depositAtMs(existing.depositAt);
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= proximityMs;
}

/**
 * Same roster member, same deposit financials — OCR commander strings may differ
 * (e.g. Banla QC vs Bania QC) when parse-time member linking already agrees.
 */
export function isMemberLinkedHistoricalDepositMatch(
  incoming: HistoricalDepositSlipIdentity,
  existing: HistoricalDepositSlipIdentity,
  proximityMs: number = DEPOSIT_AT_PROXIMITY_MS,
): boolean {
  const incomingMemberId = incoming.allianceMemberId?.trim();
  const existingMemberId = existing.allianceMemberId?.trim();
  if (!incomingMemberId || !existingMemberId) return false;
  if (incomingMemberId !== existingMemberId) return false;
  return depositSlipHistoryFinancialMatch(incoming, existing, proximityMs);
}

export function isHistoricalDepositMatch(
  incoming: HistoricalDepositSlipIdentity,
  existing: HistoricalDepositSlipIdentity,
  proximityMs: number = DEPOSIT_AT_PROXIMITY_MS,
): boolean {
  return (
    isHighConfidenceHistoricalDepositMatch(incoming, existing, proximityMs) ||
    isMemberLinkedHistoricalDepositMatch(incoming, existing, proximityMs)
  );
}

/**
 * Terminal OCR on a later job upload can carry the outcome timestamp in
 * `depositAt` while HQ history still stores the blue initiate on a locked row.
 */
export function canHistoricalOutcomeUpdateLocked(
  incoming: HistoricalDepositSlipIdentity,
  existingLocked: HistoricalDepositSlipIdentity,
): boolean {
  const incomingStatus = resolveStatus(incoming);
  if (incomingStatus !== "matured" && incomingStatus !== "looted") {
    return false;
  }
  if (resolveStatus(existingLocked) !== "locked") return false;
  if (!historicalIdentityMatch(incoming, existingLocked)) return false;

  const depositMs = depositAtMs(existingLocked.depositAt);
  const outcomeMs = incomingOutcomeMs(incoming);
  if (depositMs == null || outcomeMs == null) return false;
  if (outcomeMs < depositMs) return false;

  const termDays = incoming.termDays;
  const span = outcomeMs - depositMs;
  if (span > termDays * MS_PER_DAY + MS_PER_DAY) return false;

  if (incomingStatus === "matured") {
    const expected = termDays * MS_PER_DAY;
    return span >= expected - MATURITY_ALIGNMENT_SLACK_MS;
  }
  return true;
}

function isTerminalOutcomeDuplicate(
  incoming: HistoricalDepositSlipIdentity,
  existing: HistoricalDepositSlipIdentity,
  proximityMs: number,
): boolean {
  if (!historicalIdentityMatch(incoming, existing, proximityMs)) return false;
  const incomingStatus = resolveStatus(incoming);
  const existingStatus = resolveStatus(existing);
  if (incomingStatus === "locked" || existingStatus === "locked") {
    return false;
  }

  const a = incomingOutcomeMs(incoming);
  const b = existingOutcomeMs(existing);
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= proximityMs;
}

function mostRecentByDepositAt<T extends HistoricalDepositSlipIdentity>(
  slips: readonly T[],
): T | null {
  let best: T | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const slip of slips) {
    const ms = depositAtMs(slip.depositAt);
    if (ms == null) continue;
    if (ms >= bestMs) {
      best = slip;
      bestMs = ms;
    }
  }
  return best ?? slips[0] ?? null;
}

/**
 * Match an OCR row against stored bank history — lifecycle pairing for
 * terminal→locked across job submissions (before depositAt proximity, so
 * matured green does not latch onto a same-minute re-deposit), roster member
 * id when linked, and outcome timestamp alignment for terminal→terminal duplicates.
 */
export function findHistoricalDepositMatch<
  T extends HistoricalDepositSlipIdentity,
>(
  incoming: HistoricalDepositSlipIdentity,
  existing: readonly T[],
  proximityMs: number = DEPOSIT_AT_PROXIMITY_MS,
): T | null {
  const incomingStatus = resolveStatus(incoming);

  if (incomingStatus === "matured" || incomingStatus === "looted") {
    const lifecycleLocked: T[] = [];
    for (const slip of existing) {
      if (canHistoricalOutcomeUpdateLocked(incoming, slip)) {
        lifecycleLocked.push(slip);
      }
    }
    const locked = mostRecentByDepositAt(lifecycleLocked);
    if (locked) return locked;

    for (const slip of existing) {
      if (isTerminalOutcomeDuplicate(incoming, slip, proximityMs)) {
        return slip;
      }
    }

    // Matured must be term-aligned; proximity would false-match re-deposits.
    if (incomingStatus === "matured") return null;
  }

  for (const slip of existing) {
    if (isHighConfidenceHistoricalDepositMatch(incoming, slip, proximityMs)) {
      return slip;
    }
  }

  for (const slip of existing) {
    if (isMemberLinkedHistoricalDepositMatch(incoming, slip, proximityMs)) {
      return slip;
    }
  }

  for (const slip of existing) {
    if (isTerminalOutcomeDuplicate(incoming, slip, proximityMs)) {
      return slip;
    }
  }

  if (incomingStatus !== "looted") {
    return null;
  }

  let best: T | null = null;
  let bestDepositMs = Number.NEGATIVE_INFINITY;
  for (const slip of existing) {
    if (!canHistoricalOutcomeUpdateLocked(incoming, slip)) continue;
    const ms = depositAtMs(slip.depositAt) ?? Number.NEGATIVE_INFINITY;
    if (ms > bestDepositMs) {
      bestDepositMs = ms;
      best = slip;
    }
  }
  return best;
}

/** @deprecated Prefer {@link findHistoricalDepositMatch}. */
export function findHighConfidenceHistoricalDepositMatch<
  T extends HistoricalDepositSlipIdentity,
>(
  incoming: HistoricalDepositSlipIdentity,
  existing: readonly T[],
  proximityMs: number = DEPOSIT_AT_PROXIMITY_MS,
): T | null {
  return findHistoricalDepositMatch(incoming, existing, proximityMs);
}

/**
 * Skip when the OCR row is the same lifecycle event already stored (or a
 * locked re-read of a deposit that already terminated). Do **not** skip when
 * a locked slip should be advanced by a matured/looted OCR row — loot can land
 * inside {@link DEPOSIT_AT_PROXIMITY_MS} of initiate.
 */
export function shouldSkipHistoricalDepositDuplicate(
  incoming: HistoricalDepositSlipIdentity,
  existing: HistoricalDepositSlipIdentity,
  proximityMs: number = DEPOSIT_AT_PROXIMITY_MS,
): boolean {
  if (isTerminalOutcomeDuplicate(incoming, existing, proximityMs)) {
    return true;
  }
  if (!isHistoricalDepositMatch(incoming, existing, proximityMs)) {
    return false;
  }
  const incomingStatus = resolveStatus(incoming);
  const existingStatus = resolveStatus(existing);
  if (incomingStatus === existingStatus) return true;
  if (incomingStatus === "locked" && existingStatus !== "locked") return true;
  if (incomingStatus !== "locked" && existingStatus !== "locked") return true;
  return false;
}

/**
 * Locked history row + terminal OCR row → apply outcome onto the existing slip
 * instead of inserting a second deposit.
 */
export function shouldUpdateHistoricalDepositOutcome(
  incoming: HistoricalDepositSlipIdentity,
  existing: HistoricalDepositSlipIdentity,
  proximityMs: number = DEPOSIT_AT_PROXIMITY_MS,
): boolean {
  if (canHistoricalOutcomeUpdateLocked(incoming, existing)) {
    return true;
  }
  const incomingStatus = resolveStatus(incoming);
  const existingStatus = resolveStatus(existing);
  if (existingStatus !== "locked") return false;
  if (incomingStatus === "matured") return false;
  if (incomingStatus === "looted") {
    return isHistoricalDepositMatch(incoming, existing, proximityMs);
  }
  return false;
}
