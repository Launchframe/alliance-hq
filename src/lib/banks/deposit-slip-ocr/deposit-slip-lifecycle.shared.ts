/**
 * Timing rules for pairing a blue (locked) initiate with a green/orange
 * terminal OCR event. Shared by in-video dedupe and iterative history commit.
 */

import type { DepositStatus } from "@/lib/banks/types.shared";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** OCR slack around exact term maturity (green is termDays after blue). */
export const MATURITY_ALIGNMENT_SLACK_MS = 12 * 60 * 60 * 1000;

export type DepositSlipLifecycleLockedFields = {
  depositAt: string | null | undefined;
  termDays?: number | null;
};

export type DepositSlipLifecycleOutcomeFields = {
  /** Wall-clock of the terminal OCR row (green/orange timestamp). */
  depositAt: string | null | undefined;
  termDays?: number | null;
  status: DepositStatus | string;
};

function parseDepositAtMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Whether a locked initiate and a terminal OCR row are the same deposit's
 * lifecycle events (not a second deposit / rapid re-deposit).
 *
 * - Matured (green): outcome ≈ initiate + termDays (± {@link MATURITY_ALIGNMENT_SLACK_MS})
 * - Looted (orange): initiate ≤ outcome ≤ initiate + termDays (+ 1 day OCR slack)
 */
export function canDepositSlipLifecyclePair(
  locked: DepositSlipLifecycleLockedFields,
  outcome: DepositSlipLifecycleOutcomeFields,
): boolean {
  if (outcome.status !== "matured" && outcome.status !== "looted") return false;
  const depositMs = parseDepositAtMs(locked.depositAt);
  const outcomeMs = parseDepositAtMs(outcome.depositAt);
  if (depositMs == null || outcomeMs == null) return false;
  // Outcome cannot precede initiate; a later locked vs earlier loot is a re-deposit.
  if (outcomeMs < depositMs) return false;
  const termDays = locked.termDays ?? outcome.termDays ?? 1;
  const span = outcomeMs - depositMs;
  // Full term plus a day of OCR slack (upper bound).
  if (span > termDays * MS_PER_DAY + MS_PER_DAY) return false;
  if (outcome.status === "matured") {
    // Green must land near depositAt + termDays — not minutes/hours later.
    const expected = termDays * MS_PER_DAY;
    return span >= expected - MATURITY_ALIGNMENT_SLACK_MS;
  }
  return true;
}
