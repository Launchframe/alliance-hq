import { describe, expect, it } from "vitest";

import { compareTargetedBankToDetected } from "@/lib/banks/deposit-slip-bank-target-mismatch.shared";

describe("compareTargetedBankToDetected", () => {
  const targeted = {
    gameServerNumber: 8150,
    coordX: 699,
    coordY: 20,
    level: 7,
  };

  it("returns aligned when coords and level match", () => {
    expect(
      compareTargetedBankToDetected(targeted, {
        gameServerNumber: 8150,
        coordX: 699,
        coordY: 20,
        level: 7,
        bankName: null,
        owningAllianceTag: null,
        currentDepositValue: null,
        depositCapacity: null,
        firstCaptureDate: null,
        sources: { bankInfo: false, favorites: true },
      }),
    ).toBe("aligned");
  });

  it("returns mismatch when coordinates differ", () => {
    expect(
      compareTargetedBankToDetected(targeted, {
        gameServerNumber: 8150,
        coordX: 699,
        coordY: 99,
        level: 7,
        bankName: null,
        owningAllianceTag: null,
        currentDepositValue: null,
        depositCapacity: null,
        firstCaptureDate: null,
        sources: { bankInfo: false, favorites: true },
      }),
    ).toBe("mismatch");
  });

  it("returns insufficient_detected when context is null", () => {
    expect(compareTargetedBankToDetected(targeted, null)).toBe(
      "insufficient_detected",
    );
  });
});
