/** sessionStorage key for preferred bank when deep-linking Deposit Slip OCR. */
export const DEPOSIT_SLIP_PREFERRED_BANK_STORAGE_KEY =
  "alliance-hq.deposit-slip-preferred-bank-id";

export function readPreferredDepositSlipBankId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(
      DEPOSIT_SLIP_PREFERRED_BANK_STORAGE_KEY,
    );
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

export function writePreferredDepositSlipBankId(bankId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      DEPOSIT_SLIP_PREFERRED_BANK_STORAGE_KEY,
      bankId,
    );
  } catch {
    // Ignore quota / private mode failures — review can still pick a bank.
  }
}

export function clearPreferredDepositSlipBankId(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(DEPOSIT_SLIP_PREFERRED_BANK_STORAGE_KEY);
  } catch {
    // ignore
  }
}
