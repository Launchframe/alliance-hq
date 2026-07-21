/**
 * High-confidence match of a video-review deposit against slips already stored
 * for the same bank. Used so iterative re-uploads append only *new* events
 * instead of duplicating history that HQ already knows about.
 */

import { DEPOSIT_AT_PROXIMITY_MS } from "@/lib/banks/deposit-slip-ocr/deposit-slip-dedupe.shared";
import type { DepositStatus } from "@/lib/banks/types.shared";
import { normalizeEntityName } from "@/lib/video/dedupe/fuzzy-name-cluster.shared";

export type HistoricalDepositSlipIdentity = {
  commanderName: string;
  depositAt: string;
  amount: number;
  termDays: number;
  depositAllianceTag?: string | null;
  status?: DepositStatus;
};

function depositAtMs(value: string | Date): number | null {
  const ms =
    value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function normalizeTag(tag: string | null | undefined): string | null {
  if (tag == null) return null;
  const trimmed = tag.trim();
  return trimmed ? trimmed.toLowerCase() : null;
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
  if (
    normalizeEntityName(incoming.commanderName) !==
    normalizeEntityName(existing.commanderName)
  ) {
    return false;
  }
  if (incoming.amount !== existing.amount) return false;
  if (incoming.termDays !== existing.termDays) return false;

  const incomingTag = normalizeTag(incoming.depositAllianceTag);
  const existingTag = normalizeTag(existing.depositAllianceTag);
  if (incomingTag && existingTag && incomingTag !== existingTag) {
    return false;
  }

  const a = depositAtMs(incoming.depositAt);
  const b = depositAtMs(existing.depositAt);
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= proximityMs;
}

export function findHighConfidenceHistoricalDepositMatch<
  T extends HistoricalDepositSlipIdentity,
>(
  incoming: HistoricalDepositSlipIdentity,
  existing: readonly T[],
  proximityMs: number = DEPOSIT_AT_PROXIMITY_MS,
): T | null {
  for (const slip of existing) {
    if (isHighConfidenceHistoricalDepositMatch(incoming, slip, proximityMs)) {
      return slip;
    }
  }
  return null;
}

function resolveStatus(
  slip: HistoricalDepositSlipIdentity,
): DepositStatus {
  return slip.status ?? "locked";
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
  if (!isHighConfidenceHistoricalDepositMatch(incoming, existing, proximityMs)) {
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
 * Locked history row + terminal OCR row within the proximity window → apply
 * outcome onto the existing slip instead of inserting a second deposit.
 */
export function shouldUpdateHistoricalDepositOutcome(
  incoming: HistoricalDepositSlipIdentity,
  existing: HistoricalDepositSlipIdentity,
  proximityMs: number = DEPOSIT_AT_PROXIMITY_MS,
): boolean {
  if (!isHighConfidenceHistoricalDepositMatch(incoming, existing, proximityMs)) {
    return false;
  }
  const incomingStatus = resolveStatus(incoming);
  const existingStatus = resolveStatus(existing);
  return (
    existingStatus === "locked" &&
    (incomingStatus === "matured" || incomingStatus === "looted")
  );
}
