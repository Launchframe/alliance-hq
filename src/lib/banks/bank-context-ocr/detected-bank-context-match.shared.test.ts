import { describe, expect, it } from "vitest";

import { matchDetectedBankContextToBanks } from "@/lib/banks/bank-context-ocr/detected-bank-context-match.shared";
import type { DetectedBankContext } from "@/lib/banks/bank-context-ocr/merge-bank-context.shared";

const BASE_CONTEXT: DetectedBankContext = {
  gameServerNumber: 1203,
  coordX: 199,
  coordY: 599,
  level: 1,
  owningAllianceTag: "BigD",
  bankName: "Trailblazer Bank",
  currentDepositValue: 29_387,
  depositCapacity: 600_000,
  firstCaptureDate: "2026-07-08",
  sources: { bankInfo: true, favorites: true },
};

const BANKS = [
  { id: "bank-1", gameServerNumber: 1203, coordX: 199, coordY: 599 },
  { id: "bank-2", gameServerNumber: 1203, coordX: 1, coordY: 2 },
];

describe("matchDetectedBankContextToBanks", () => {
  it("returns none when no context was detected", () => {
    expect(matchDetectedBankContextToBanks(null, BANKS)).toEqual({
      kind: "none",
    });
  });

  it("returns partial when coords are missing", () => {
    const context = { ...BASE_CONTEXT, coordX: null, coordY: null };
    expect(matchDetectedBankContextToBanks(context, BANKS)).toEqual({
      kind: "partial",
    });
  });

  it("returns partial when gameServerNumber is missing", () => {
    const context = { ...BASE_CONTEXT, gameServerNumber: null };
    expect(matchDetectedBankContextToBanks(context, BANKS)).toEqual({
      kind: "partial",
    });
  });

  it("returns matched with the matching bank id when coords match", () => {
    expect(matchDetectedBankContextToBanks(BASE_CONTEXT, BANKS)).toEqual({
      kind: "matched",
      bankId: "bank-1",
    });
  });

  it("returns unmatched_coords when full coords have no matching bank", () => {
    const context = { ...BASE_CONTEXT, coordX: 42, coordY: 42 };
    expect(matchDetectedBankContextToBanks(context, BANKS)).toEqual({
      kind: "unmatched_coords",
    });
  });

  it("returns unmatched_coords when the bank list is empty", () => {
    expect(matchDetectedBankContextToBanks(BASE_CONTEXT, [])).toEqual({
      kind: "unmatched_coords",
    });
  });
});
