import { activeDeposits } from "@/lib/banks/optimization.shared";
import type { BankWithSlips } from "@/lib/banks/types.shared";

export type BankForManagementSort = Pick<
  BankWithSlips,
  "level" | "coordX" | "coordY" | "currentDepositCount" | "depositSlips"
>;

/** Active deposit count for management list ordering. */
export function bankManagementActiveDepositCount(
  bank: BankForManagementSort,
  now: Date = new Date(),
): number {
  if (bank.depositSlips.length > 0) {
    return activeDeposits(bank.depositSlips, now).length;
  }
  return bank.currentDepositCount ?? 0;
}

export function compareBanksForManagementDisplay(
  a: BankForManagementSort,
  b: BankForManagementSort,
  now: Date = new Date(),
): number {
  if (a.level !== b.level) {
    return b.level - a.level;
  }

  const countA = bankManagementActiveDepositCount(a, now);
  const countB = bankManagementActiveDepositCount(b, now);
  if (countA !== countB) {
    return countB - countA;
  }

  if (a.coordX !== b.coordX) {
    return a.coordX - b.coordX;
  }
  return a.coordY - b.coordY;
}

export function sortBanksForManagementDisplay<T extends BankForManagementSort>(
  banks: readonly T[],
  now: Date = new Date(),
): T[] {
  return [...banks].sort((a, b) =>
    compareBanksForManagementDisplay(a, b, now),
  );
}
