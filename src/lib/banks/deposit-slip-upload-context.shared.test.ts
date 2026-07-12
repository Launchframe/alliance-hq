import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearPreferredDepositSlipBankId,
  DEPOSIT_SLIP_PREFERRED_BANK_STORAGE_KEY,
  readPreferredDepositSlipBankId,
  writePreferredDepositSlipBankId,
} from "@/lib/banks/deposit-slip-upload-context.shared";

describe("deposit-slip-upload-context", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    const sessionStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    };
    vi.stubGlobal("window", { sessionStorage });
    vi.stubGlobal("sessionStorage", sessionStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips preferred bank id", () => {
    writePreferredDepositSlipBankId("bank_abc");
    expect(readPreferredDepositSlipBankId()).toBe("bank_abc");
  });

  it("clears stale preference when deep-link is absent", () => {
    writePreferredDepositSlipBankId("bank_abc");
    clearPreferredDepositSlipBankId();
    expect(readPreferredDepositSlipBankId()).toBeNull();
    expect(store.has(DEPOSIT_SLIP_PREFERRED_BANK_STORAGE_KEY)).toBe(false);
  });

  it("no-ops when window is undefined", () => {
    vi.unstubAllGlobals();
    expect(readPreferredDepositSlipBankId()).toBeNull();
    expect(() => writePreferredDepositSlipBankId("bank_abc")).not.toThrow();
    expect(() => clearPreferredDepositSlipBankId()).not.toThrow();
  });
});
