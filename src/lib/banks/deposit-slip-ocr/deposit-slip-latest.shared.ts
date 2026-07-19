import type { SerializedDepositSlip } from "@/lib/banks/types.shared";

function depositAtMs(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

/** Newest deposit event for the bank hero (by depositAt, then createdAt). */
export function pickLatestDepositSlip(
  slips: readonly SerializedDepositSlip[],
): SerializedDepositSlip | null {
  if (slips.length === 0) return null;
  let best = slips[0]!;
  for (let i = 1; i < slips.length; i += 1) {
    const slip = slips[i]!;
    const bestAt = depositAtMs(best.depositAt);
    const slipAt = depositAtMs(slip.depositAt);
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
