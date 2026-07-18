/**
 * High-confidence match of a video-review deposit against slips already stored
 * for the same bank. Used so iterative re-uploads append only *new* events
 * instead of duplicating history that HQ already knows about.
 */

import { DEPOSIT_AT_PROXIMITY_MS } from "@/lib/banks/deposit-slip-ocr/deposit-slip-dedupe.shared";
import type { SerializedDepositSlip } from "@/lib/banks/types.shared";
import { normalizeEntityName } from "@/lib/video/dedupe/fuzzy-name-cluster.shared";

export type HistoricalDepositSlipIdentity = {
  commanderName: string;
  depositAt: string;
  amount: number;
  termDays: number;
  depositAllianceTag?: string | null;
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

/** Newest deposit event for the bank hero (by depositAt, then createdAt). */
export function pickLatestDepositSlip(
  slips: readonly SerializedDepositSlip[],
): SerializedDepositSlip | null {
  if (slips.length === 0) return null;
  let best = slips[0]!;
  for (let i = 1; i < slips.length; i += 1) {
    const slip = slips[i]!;
    const bestAt = Date.parse(best.depositAt);
    const slipAt = Date.parse(slip.depositAt);
    if (slipAt > bestAt) {
      best = slip;
      continue;
    }
    if (slipAt === bestAt && slip.createdAt > best.createdAt) {
      best = slip;
    }
  }
  return best;
}
