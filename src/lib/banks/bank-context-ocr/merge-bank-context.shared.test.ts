import { describe, expect, it } from "vitest";

import {
  coalesceDetectedBankContext,
  isDetectedBankContext,
  mergeBankContext,
  readDetectedBankContextFromRawExtract,
} from "@/lib/banks/bank-context-ocr/merge-bank-context.shared";
import { parseBankInfoText } from "@/lib/banks/bank-context-ocr/parse-bank-info-text.shared";
import { parseFavoritesText } from "@/lib/banks/bank-context-ocr/parse-favorites-text.shared";

const BANK_INFO_LINES = [
  "Lv.1",
  "#1203 [BigD]Trailblazer Bank",
  "City Owner: #1203 [BigD]Big Delinquents",
  "29,387/600,000",
  "The first capture time of this City is 2026-7-8",
];

const FAVORITES_LINES = [
  "ADD TO FAVORITES",
  "Warzone #1203 X:199 Y:599",
  "Lv.1 [BigD]Trailblazer Bank",
];

describe("mergeBankContext", () => {
  it("merges bank info and favorites from golden fixtures", () => {
    const bankInfo = parseBankInfoText(BANK_INFO_LINES);
    const favorites = parseFavoritesText(FAVORITES_LINES);
    expect(mergeBankContext(bankInfo, favorites)).toEqual({
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
    });
  });

  it("uses favorites for coordinates when only favorites is present", () => {
    const favorites = parseFavoritesText(FAVORITES_LINES);
    expect(mergeBankContext(null, favorites)).toEqual({
      gameServerNumber: 1203,
      coordX: 199,
      coordY: 599,
      level: 1,
      owningAllianceTag: "BigD",
      bankName: "Trailblazer Bank",
      currentDepositValue: null,
      depositCapacity: null,
      firstCaptureDate: null,
      sources: { bankInfo: false, favorites: true },
    });
  });

  it("uses bank info for deposit fields when only bank info is present", () => {
    const bankInfo = parseBankInfoText(BANK_INFO_LINES);
    expect(mergeBankContext(bankInfo, null)).toEqual({
      gameServerNumber: 1203,
      coordX: null,
      coordY: null,
      level: 1,
      owningAllianceTag: "BigD",
      bankName: "Trailblazer Bank",
      currentDepositValue: 29_387,
      depositCapacity: 600_000,
      firstCaptureDate: "2026-07-08",
      sources: { bankInfo: true, favorites: false },
    });
  });

  it("returns null when both inputs are null", () => {
    expect(mergeBankContext(null, null)).toBeNull();
  });
});

describe("coalesceDetectedBankContext", () => {
  it("returns the non-null side when one input is null", () => {
    const bankOnly = mergeBankContext(parseBankInfoText(BANK_INFO_LINES), null);
    expect(coalesceDetectedBankContext(bankOnly, null)).toEqual(bankOnly);
    expect(coalesceDetectedBankContext(null, bankOnly)).toEqual(bankOnly);
  });

  it("merges coords from a later favorites frame", () => {
    const bankOnly = mergeBankContext(parseBankInfoText(BANK_INFO_LINES), null);
    const withCoords = mergeBankContext(null, parseFavoritesText(FAVORITES_LINES));
    expect(coalesceDetectedBankContext(bankOnly, withCoords)).toEqual({
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
    });
  });

  it("prefers favorites coordinates when both frames have coords", () => {
    const frameA = mergeBankContext(parseBankInfoText(BANK_INFO_LINES), {
      gameServerNumber: 1203,
      coordX: 100,
      coordY: 200,
      level: 1,
      owningAllianceTag: "BigD",
      bankName: "Trailblazer Bank",
    });
    const frameB = mergeBankContext(null, parseFavoritesText(FAVORITES_LINES));
    const merged = coalesceDetectedBankContext(frameA, frameB);
    expect(merged?.coordX).toBe(199);
    expect(merged?.coordY).toBe(599);
  });

  it("accumulates source flags across frames", () => {
    const bankOnly = mergeBankContext(parseBankInfoText(BANK_INFO_LINES), null);
    const favOnly = mergeBankContext(null, parseFavoritesText(FAVORITES_LINES));
    const merged = coalesceDetectedBankContext(bankOnly, favOnly);
    expect(merged?.sources).toEqual({ bankInfo: true, favorites: true });
  });

  it("does not treat deposit-slip identity lines as bank-info context", () => {
    const fromDepositSlip = mergeBankContext(
      parseBankInfoText(["#1203 [BigD]SomeCommander"]),
      null,
    );
    const withCoords = mergeBankContext(null, parseFavoritesText(FAVORITES_LINES));
    expect(fromDepositSlip).toBeNull();
    expect(coalesceDetectedBankContext(fromDepositSlip, withCoords)?.bankName).toBe(
      "Trailblazer Bank",
    );
  });
});

describe("isDetectedBankContext", () => {
  it("accepts a valid detected bank context payload", () => {
    const context = mergeBankContext(
      parseBankInfoText(BANK_INFO_LINES),
      parseFavoritesText(FAVORITES_LINES),
    );
    expect(isDetectedBankContext(context)).toBe(true);
  });

  it("rejects malformed payloads", () => {
    expect(isDetectedBankContext(null)).toBe(false);
    expect(isDetectedBankContext({ sources: { bankInfo: true } })).toBe(false);
  });
});

describe("readDetectedBankContextFromRawExtract", () => {
  it("reads detectedBankContext from parse session rawExtractJson", () => {
    const context = mergeBankContext(
      parseBankInfoText(BANK_INFO_LINES),
      parseFavoritesText(FAVORITES_LINES),
    );
    expect(
      readDetectedBankContextFromRawExtract({
        depositPolicy: null,
        minimumDeposit: null,
        slips: [],
        detectedBankContext: context,
      }),
    ).toEqual(context);
  });

  it("returns null when field is missing or invalid", () => {
    expect(readDetectedBankContextFromRawExtract(null)).toBeNull();
    expect(
      readDetectedBankContextFromRawExtract({ detectedBankContext: "bad" }),
    ).toBeNull();
  });
});
