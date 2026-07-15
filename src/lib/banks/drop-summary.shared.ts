import type { SerializedBank, SerializedDepositSlip } from "./types.shared";

/**
 * In-game interest rates per deposit term.
 * Return is principal * rate upon maturity.
 */
const INTEREST_RATES: Record<number, number> = {
  1: 0.05,
  3: 0.1,
  5: 0.15,
};

export type BankDropSummary = {
  bank: SerializedBank;
  /** Milliseconds the bank was held. */
  durationMs: number;
  durationLabel: string;
  /** Total number of deposits placed. */
  totalDeposits: number;
  /** Sum of all deposit amounts (principal placed). */
  totalCrystalGoldDeposited: number;
  /** Total interest earned from matured deposits. */
  totalInterestEarned: number;
  /** Overall ROI: interestEarned / totalDeposited * 100. */
  investmentReturnPercent: number;
  /** Sum of amounts on looted deposits. */
  crystalGoldLooted: number;
  /** looted / (matured principal + looted principal) * 100. */
  slippagePercent: number;
  /** Breakdown by status. */
  maturedCount: number;
  lootedCount: number;
  lockedCount: number;
  maturedValue: number;
  lockedValue: number;
};

export function computeBankDropSummary(
  bank: SerializedBank,
  slips: SerializedDepositSlip[],
  droppedAt: Date = new Date(),
): BankDropSummary {
  const capturedAt = bank.capturedAt ? new Date(bank.capturedAt) : null;
  const durationMs = capturedAt
    ? droppedAt.getTime() - capturedAt.getTime()
    : 0;

  let maturedCount = 0;
  let lootedCount = 0;
  let lockedCount = 0;
  let maturedValue = 0;
  let lootedValue = 0;
  let lockedValue = 0;
  let totalInterestEarned = 0;

  for (const slip of slips) {
    switch (slip.status) {
      case "matured":
        maturedCount++;
        maturedValue += slip.amount;
        totalInterestEarned +=
          slip.amount * (INTEREST_RATES[slip.termDays] ?? 0.05);
        break;
      case "looted":
        lootedCount++;
        lootedValue += slip.amount;
        break;
      default:
        lockedCount++;
        lockedValue += slip.amount;
        break;
    }
  }

  const totalDeposited = maturedValue + lootedValue + lockedValue;
  const investmentReturnPercent =
    totalDeposited > 0 ? (totalInterestEarned / totalDeposited) * 100 : 0;
  const terminalValue = maturedValue + lootedValue;
  const slippagePercent =
    terminalValue > 0 ? (lootedValue / terminalValue) * 100 : 0;

  return {
    bank,
    durationMs,
    durationLabel: formatDuration(durationMs),
    totalDeposits: slips.length,
    totalCrystalGoldDeposited: totalDeposited,
    totalInterestEarned: Math.round(totalInterestEarned),
    investmentReturnPercent: Math.round(investmentReturnPercent * 100) / 100,
    crystalGoldLooted: lootedValue,
    slippagePercent: Math.round(slippagePercent * 100) / 100,
    maturedCount,
    lootedCount,
    lockedCount,
    maturedValue,
    lockedValue,
  };
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "unknown";
  const hours = Math.floor(ms / (60 * 60 * 1000));
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  if (days === 0) return `${remainingHours}h`;
  if (remainingHours === 0) return `${days}d`;
  return `${days}d ${remainingHours}h`;
}
