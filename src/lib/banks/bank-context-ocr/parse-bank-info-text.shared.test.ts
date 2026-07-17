import { describe, expect, it } from "vitest";

import { parseBankInfoText } from "@/lib/banks/bank-context-ocr/parse-bank-info-text.shared";

const BANK_INFO_LINES = [
  "Bank Information",
  "Lv.1",
  "#1203 [BigD]Trailblazer Bank",
  "City Owner: #1203 [BigD]Big Delinquents",
  "29,387/600,000",
  "The first capture time of this City is 2026-7-8",
];

describe("parseBankInfoText", () => {
  it("parses golden bank information lines", () => {
    expect(parseBankInfoText(BANK_INFO_LINES)).toEqual({
      gameServerNumber: 1203,
      owningAllianceTag: "BigD",
      bankName: "Trailblazer Bank",
      level: 1,
      currentDepositValue: 29_387,
      depositCapacity: 600_000,
      firstCaptureDate: "2026-07-08",
    });
  });

  it("prefers City Owner alliance tag over title tag", () => {
    const lines = [
      "#1203 [Roar]Trailblazer Bank",
      "City Owner: #1203 [BigD]Big Delinquents",
    ];
    const parsed = parseBankInfoText(lines);
    expect(parsed?.owningAllianceTag).toBe("BigD");
    expect(parsed?.bankName).toBe("Trailblazer Bank");
  });

  it("tolerates missing spaces around hash and brackets", () => {
    const lines = [
      "Lv:1",
      "#1203[BigD]Trailblazer Bank",
      "City Owner: #1203[BigD]Big Delinquents",
      "29387/600000",
    ];
    expect(parseBankInfoText(lines)).toEqual({
      gameServerNumber: 1203,
      owningAllianceTag: "BigD",
      bankName: "Trailblazer Bank",
      level: 1,
      currentDepositValue: 29_387,
      depositCapacity: 600_000,
      firstCaptureDate: null,
    });
  });

  it("parses level variants from OCR", () => {
    expect(parseBankInfoText(["Lv:1", "29,387/600,000"])?.level).toBe(1);
    expect(parseBankInfoText(["Lvi3", "29,387/600,000"])?.level).toBe(3);
  });

  it("returns null when nothing useful matched", () => {
    expect(parseBankInfoText([])).toBeNull();
    expect(parseBankInfoText(["Bank Information", "Back"])).toBeNull();
  });

  it("returns partial parse when only deposit value is present", () => {
    expect(parseBankInfoText(["29,387/600,000"])).toEqual({
      gameServerNumber: null,
      owningAllianceTag: null,
      bankName: null,
      level: null,
      currentDepositValue: 29_387,
      depositCapacity: 600_000,
      firstCaptureDate: null,
    });
  });
});
