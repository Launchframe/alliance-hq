/**
 * High-confidence match of a video-review deposit against slips already stored
 * for the same bank. Used so iterative re-uploads append only *new* events
 * instead of duplicating history that HQ already knows about.
 *
 * Identity for re-reads of the same OCR event uses depositAt proximity
 * ({@link DEPOSIT_AT_PROXIMITY_MS}). Terminal green/orange rows that close a
 * prior locked initiate use lifecycle timing (term-aligned maturity / loot
 * window) — never require the terminal timestamp to equal the blue depositAt.
 */

import { DEPOSIT_AT_PROXIMITY_MS } from "@/lib/banks/deposit-slip-ocr/deposit-slip-dedupe.shared";
import { canDepositSlipLifecyclePair } from "@/lib/banks/deposit-slip-ocr/deposit-slip-lifecycle.shared";
import type { DepositStatus } from "@/lib/banks/types.shared";
import { normalizeEntityName } from "@/lib/video/dedupe/fuzzy-name-cluster.shared";

export type HistoricalDepositSlipIdentity = {
  commanderName: string;
  depositAt: string;
  amount: number;
  termDays: number;
  depositAllianceTag?: string | null;
  status?: DepositStatus;
  /**
   * When set (in-video lifecycle merge), wall-clock of the green/orange row.
   * Terminal-only OCR leaves this null and puts the outcome time in depositAt.
   */
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

function isTerminalStatus(status: DepositStatus): boolean {
  return status === "matured" || status === "looted";
}

function depositFinancialFieldsMatch(
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

/** Commander / amount / term / non-conflicting tags — ignores timestamps. */
function hasHistoricalDepositIdentityFields(
  incoming: HistoricalDepositSlipIdentity,
  existing: HistoricalDepositSlipIdentity,
): boolean {
  if (
    normalizeEntityName(incoming.commanderName) !==
    normalizeEntityName(existing.commanderName)
  ) {
    return false;
  }
  return depositFinancialFieldsMatch(incoming, existing);
}

function hasMemberLinkedDepositIdentityFields(
  incoming: HistoricalDepositSlipIdentity,
  existing: HistoricalDepositSlipIdentity,
): boolean {
  const incomingMemberId = incoming.allianceMemberId?.trim();
  const existingMemberId = existing.allianceMemberId?.trim();
  if (!incomingMemberId || !existingMemberId) return false;
  if (incomingMemberId !== existingMemberId) return false;
  return depositFinancialFieldsMatch(incoming, existing);
}

function sharesDepositIdentity(
  incoming: HistoricalDepositSlipIdentity,
  existing: HistoricalDepositSlipIdentity,
): boolean {
  return (
    hasHistoricalDepositIdentityFields(incoming, existing) ||
    hasMemberLinkedDepositIdentityFields(incoming, existing)
  );
}

/** Amount, term, depositAt proximity, and non-conflicting alliance tags. */
export function depositSlipHistoryFinancialMatch(
  incoming: HistoricalDepositSlipIdentity,
  existing: HistoricalDepositSlipIdentity,
  proximityMs: number = DEPOSIT_AT_PROXIMITY_MS,
): boolean {
  if (!depositFinancialFieldsMatch(incoming, existing)) return false;

  const a = depositAtMs(incoming.depositAt);
  const b = depositAtMs(existing.depositAt);
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= proximityMs;
}

/**
 * True when `incoming` is a high-confidence re-read of `existing` keyed on
 * depositAt proximity (same initiate / same OCR minute noise).
 *
 * Status is intentionally excluded — use {@link shouldSkipHistoricalDepositDuplicate}
 * / {@link shouldUpdateHistoricalDepositOutcome} for skip vs outcome-update.
 */
export function isHighConfidenceHistoricalDepositMatch(
  incoming: HistoricalDepositSlipIdentity,
  existing: HistoricalDepositSlipIdentity,
  proximityMs: number = DEPOSIT_AT_PROXIMITY_MS,
): boolean {
  if (!hasHistoricalDepositIdentityFields(incoming, existing)) return false;
  return depositSlipHistoryFinancialMatch(incoming, existing, proximityMs);
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
  if (!hasMemberLinkedDepositIdentityFields(incoming, existing)) return false;
  return depositSlipHistoryFinancialMatch(incoming, existing, proximityMs);
}

/**
 * Wall-clock of the terminal OCR event. Lifecycle-merged drafts keep initiate
 * in `depositAt` and the green/orange time in `outcomeAt`; terminal-only clips
 * put the outcome time in `depositAt`.
 */
function terminalOutcomeTimeIso(
  incoming: HistoricalDepositSlipIdentity,
): string {
  const outcome = incoming.outcomeAt?.trim();
  if (outcome) return outcome;
  return incoming.depositAt;
}

/**
 * Terminal OCR row closes (or re-states) the deposit that began at
 * `existing.depositAt` under Season 5 lifecycle timing.
 */
export function isLifecycleHistoricalDepositMatch(
  incoming: HistoricalDepositSlipIdentity,
  existing: HistoricalDepositSlipIdentity,
): boolean {
  if (!sharesDepositIdentity(incoming, existing)) return false;
  const incomingStatus = resolveStatus(incoming);
  if (!isTerminalStatus(incomingStatus)) return false;

  return canDepositSlipLifecyclePair(
    { depositAt: existing.depositAt, termDays: existing.termDays },
    {
      depositAt: terminalOutcomeTimeIso(incoming),
      termDays: incoming.termDays,
      status: incomingStatus,
    },
  );
}

export function isHistoricalDepositMatch(
  incoming: HistoricalDepositSlipIdentity,
  existing: HistoricalDepositSlipIdentity,
  proximityMs: number = DEPOSIT_AT_PROXIMITY_MS,
): boolean {
  return (
    isHighConfidenceHistoricalDepositMatch(incoming, existing, proximityMs) ||
    isMemberLinkedHistoricalDepositMatch(incoming, existing, proximityMs) ||
    isLifecycleHistoricalDepositMatch(incoming, existing)
  );
}

export function findHistoricalDepositMatch<
  T extends HistoricalDepositSlipIdentity,
>(
  incoming: HistoricalDepositSlipIdentity,
  existing: readonly T[],
  proximityMs: number = DEPOSIT_AT_PROXIMITY_MS,
): T | null {
  for (const slip of existing) {
    if (isHistoricalDepositMatch(incoming, slip, proximityMs)) {
      return slip;
    }
  }
  return null;
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
 * Prefer lifecycle pairing for terminal OCR (so day-later green/orange updates
 * the locked initiate, and does not latch onto a same-minute re-deposit).
 * Matured rows never fall back to depositAt proximity — green near a fresh
 * blue is a re-deposit, not the prior initiate. Loot may still use proximity
 * for same-minute re-reads after an early termination.
 */
export function findHighConfidenceHistoricalDepositMatch<
  T extends HistoricalDepositSlipIdentity,
>(
  incoming: HistoricalDepositSlipIdentity,
  existing: readonly T[],
  proximityMs: number = DEPOSIT_AT_PROXIMITY_MS,
): T | null {
  const incomingStatus = resolveStatus(incoming);

  if (isTerminalStatus(incomingStatus)) {
    const lifecycleLocked: T[] = [];
    const lifecycleTerminal: T[] = [];
    for (const slip of existing) {
      if (!isLifecycleHistoricalDepositMatch(incoming, slip)) continue;
      if (resolveStatus(slip) === "locked") lifecycleLocked.push(slip);
      else lifecycleTerminal.push(slip);
    }
    const locked = mostRecentByDepositAt(lifecycleLocked);
    if (locked) return locked;
    const closed = mostRecentByDepositAt(lifecycleTerminal);
    if (closed) return closed;

    // Matured must be term-aligned; proximity would false-match re-deposits.
    if (incomingStatus === "matured") return null;
  }

  for (const slip of existing) {
    if (isHighConfidenceHistoricalDepositMatch(incoming, slip, proximityMs)) {
      return slip;
    }
    if (isMemberLinkedHistoricalDepositMatch(incoming, slip, proximityMs)) {
      return slip;
    }
  }
  return null;
}

/**
 * Skip when the OCR row is the same lifecycle event already stored (or a
 * locked re-read of a deposit that already terminated). Do **not** skip when
 * a locked slip should be advanced by a matured/looted OCR row — loot can land
 * inside {@link DEPOSIT_AT_PROXIMITY_MS} of initiate, and maturity is days later.
 */
export function shouldSkipHistoricalDepositDuplicate(
  incoming: HistoricalDepositSlipIdentity,
  existing: HistoricalDepositSlipIdentity,
  proximityMs: number = DEPOSIT_AT_PROXIMITY_MS,
): boolean {
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
 *
 * Matured (green) requires term-aligned lifecycle pairing. Looted (orange) may
 * also match via depositAt proximity when loot lands minutes after initiate.
 */
export function shouldUpdateHistoricalDepositOutcome(
  incoming: HistoricalDepositSlipIdentity,
  existing: HistoricalDepositSlipIdentity,
  proximityMs: number = DEPOSIT_AT_PROXIMITY_MS,
): boolean {
  const incomingStatus = resolveStatus(incoming);
  const existingStatus = resolveStatus(existing);
  if (existingStatus !== "locked") return false;
  if (incomingStatus === "matured") {
    return isLifecycleHistoricalDepositMatch(incoming, existing);
  }
  if (incomingStatus === "looted") {
    return isHistoricalDepositMatch(incoming, existing, proximityMs);
  }
  return false;
}
