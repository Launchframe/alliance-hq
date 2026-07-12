import { describe, expect, it } from "vitest";

import {
  parseCityListBanks,
  parseCityListFooter,
  parseCityListHeader,
  parseCityListServerTime,
  parseCityListText,
  parseCompactCrystalGoldValue,
} from "@/lib/banks/city-list-ocr/parse-city-list-text.shared";

/**
 * Golden lines transcribed from bank-stronghold-city-list.png: City List →
 * Bank Stronghold tab, 6 captured banks (out of an 8 slot cap), 2/2 captures
 * left today. Tesseract's PSM 6 uniform-block mode tends to merge same-row
 * tile text into one line (all three tiles share a vertical band), so each
 * tile attribute (value / level / coords / deposits) below spans one line
 * across the 3-column grid rather than one line per tile.
 */
const BANK_STRONGHOLD_CITY_LIST_LINES = [
  "CITY LIST",
  "City Bank Stronghold Trade Post",
  "Total CrystalGold Deposited: 3.48M Bank Strongholds captured: 6/8",
  "600.00K 600.00K 600.00K",
  "Lv.3 Lv.2 Lv.2",
  "#1211 (X:599, Y:499) #1211 (X:699, Y:599) #1211 (X:699, Y:499)",
  "100/100 100/100 100/100",
  "599.96K 597.26K 486.00K",
  "Lv.2 Lv.2 Lv.2",
  "#1211 (X:699, Y:399) #1211 (X:699, Y:299) #1211 (X:699, Y:99)",
  "100/100 100/100 81/100",
  "Server Time: 2026-7-11 16:57:24",
  "Bank Stronghold captures left today: 2/2",
];

describe("parseCompactCrystalGoldValue", () => {
  it("parses K suffix", () => {
    expect(parseCompactCrystalGoldValue("600.00", "K")).toBe(600_000);
    expect(parseCompactCrystalGoldValue("81", undefined)).toBe(81);
  });

  it("parses M suffix", () => {
    expect(parseCompactCrystalGoldValue("3.48", "M")).toBe(3_480_000);
  });
});

describe("parseCityListServerTime", () => {
  it("parses single-digit month/day as UTC ISO", () => {
    expect(parseCityListServerTime("Server Time: 2026-7-11 16:57:24")).toBe(
      "2026-07-11T16:57:24.000Z",
    );
  });

  it("returns null when no timestamp present", () => {
    expect(parseCityListServerTime("Bank Stronghold")).toBeNull();
  });
});

describe("parseCityListHeader", () => {
  it("parses total deposited and captured count/limit", () => {
    const header = parseCityListHeader(BANK_STRONGHOLD_CITY_LIST_LINES);
    expect(header.totalCrystalGoldDeposited).toBe(3_480_000);
    expect(header.capturedCount).toBe(6);
    expect(header.capturedLimit).toBe(8);
  });
});

describe("parseCityListFooter", () => {
  it("parses server time and captures left today", () => {
    const footer = parseCityListFooter(BANK_STRONGHOLD_CITY_LIST_LINES);
    expect(footer.serverTime).toBe("2026-07-11T16:57:24.000Z");
    expect(footer.capturesRemainingToday).toBe(2);
    expect(footer.capturesLimitToday).toBe(2);
  });
});

describe("parseCityListBanks", () => {
  it("zips per-tile tokens across merged grid rows into 6 banks", () => {
    const banks = parseCityListBanks(BANK_STRONGHOLD_CITY_LIST_LINES);
    expect(banks).toHaveLength(6);

    expect(banks[0]).toEqual({
      level: 3,
      crystalGoldValue: 600_000,
      gameServerNumber: 1211,
      coordX: 599,
      coordY: 499,
      currentDepositCount: 100,
    });
    expect(banks[1]).toMatchObject({
      level: 2,
      crystalGoldValue: 600_000,
      coordX: 699,
      coordY: 599,
      currentDepositCount: 100,
    });
    expect(banks[2]).toMatchObject({
      crystalGoldValue: 600_000,
      coordX: 699,
      coordY: 499,
    });
    expect(banks[3]).toMatchObject({
      crystalGoldValue: 599_960,
      coordX: 699,
      coordY: 399,
    });
    expect(banks[4]).toMatchObject({
      crystalGoldValue: 597_260,
      coordX: 699,
      coordY: 299,
    });
    expect(banks[5]).toEqual({
      level: 2,
      crystalGoldValue: 486_000,
      gameServerNumber: 1211,
      coordX: 699,
      coordY: 99,
      currentDepositCount: 81,
    });
  });

  it("does not confuse the header's total deposited value with a tile value", () => {
    const banks = parseCityListBanks(BANK_STRONGHOLD_CITY_LIST_LINES);
    expect(banks.every((bank) => bank.crystalGoldValue !== 3_480_000)).toBe(
      true,
    );
  });

  it("supports square-bracket coordinate formatting", () => {
    const banks = parseCityListBanks([
      "600.00K",
      "Lv.2",
      "#1234 [X:100, Y:200]",
      "50/100",
    ]);
    expect(banks).toEqual([
      {
        level: 2,
        crystalGoldValue: 600_000,
        gameServerNumber: 1234,
        coordX: 100,
        coordY: 200,
        currentDepositCount: 50,
      },
    ]);
  });

  it("tolerates OCR-garbled coordinates and missing Lv lines", () => {
    // Captured from a real Tesseract pass on bank-stronghold-city-list.png.
    const banks = parseCityListBanks([
      "Fo (/ 600.00K  o 4 600.00K © ( 600.00K",
      "Q#1211x:699,v:399) ()#1211(X:699,V:299) (#1211 [X:699, V:99)",
    ]);
    expect(banks).toHaveLength(3);
    expect(banks[0]).toMatchObject({
      crystalGoldValue: 600_000,
      gameServerNumber: 1211,
      coordX: 699,
      coordY: 399,
      level: 1,
      currentDepositCount: null,
    });
    expect(banks[1]).toMatchObject({
      coordX: 699,
      coordY: 299,
    });
    expect(banks[2]).toMatchObject({
      coordX: 699,
      coordY: 99,
    });
  });

  it("accepts yen-symbol Y and restores lost decimals in K amounts", () => {
    const banks = parseCityListBanks([
      "600.00K 59996K 59726K",
      "Q #1211 [X:598, Y¥:499) Q#1211 [X:699, ¥:539) Q #1211 [X:699, ¥:499]",
    ]);
    expect(banks).toHaveLength(3);
    expect(banks[0]).toMatchObject({
      crystalGoldValue: 600_000,
      coordX: 598,
      coordY: 499,
    });
    expect(banks[1]).toMatchObject({
      crystalGoldValue: 599_960,
      coordX: 699,
      coordY: 539,
    });
    expect(banks[2]).toMatchObject({
      crystalGoldValue: 597_260,
      coordX: 699,
      coordY: 499,
    });
  });
});

describe("parseCityListText", () => {
  it("parses the full snapshot and marks it complete when banks match captured count", () => {
    const snapshot = parseCityListText(BANK_STRONGHOLD_CITY_LIST_LINES);
    expect(snapshot.banks).toHaveLength(6);
    expect(snapshot.totalCrystalGoldDeposited).toBe(3_480_000);
    expect(snapshot.capturedCount).toBe(6);
    expect(snapshot.capturedLimit).toBe(8);
    expect(snapshot.capturesRemainingToday).toBe(2);
    expect(snapshot.capturesLimitToday).toBe(2);
    expect(snapshot.serverTime).toBe("2026-07-11T16:57:24.000Z");
    expect(snapshot.isComplete).toBe(true);
  });

  it("marks incomplete when fewer tiles are visible than the captured count", () => {
    const snapshot = parseCityListText([
      "Bank Strongholds captured: 6/8",
      "600.00K",
      "Lv.2",
      "#1211 (X:599, Y:499)",
      "100/100",
    ]);
    expect(snapshot.banks).toHaveLength(1);
    expect(snapshot.capturedCount).toBe(6);
    expect(snapshot.isComplete).toBe(false);
  });

  it("recovers six tiles from a real noisy Tesseract pass", () => {
    const snapshot = parseCityListText([
      "CITY LIST zl",
      "City BankiStronghold] Trade Post",
      "& sian dy Bank Strongholds captured: 6/8",
      "© (Jeooook © (Je0000Kk © (J 600.00K",
      "YY a YY YS ow",
      "Q #1211 [X:598, Y¥:499) Q#1211 [X:699, ¥:539) Q #1211 [X:699, ¥:499]",
      "© (Js9996k © (J59726K (J 486.00K",
      "tS PRC PR",
      "Q#1211(x:699,v:399) (#1211 (X:699,V:239] (#1211 [X:699, V:99)",
      "Server Time: 2026-7-11 16:57:24",
      "Bank Stronghold captures left today: 2/2",
    ]);
    expect(snapshot.capturedCount).toBe(6);
    expect(snapshot.banks).toHaveLength(6);
    expect(snapshot.isComplete).toBe(true);
    expect(snapshot.banks.every((bank) => bank.gameServerNumber === 1211)).toBe(
      true,
    );
    expect(
      snapshot.banks.some(
        (bank) => bank.coordX === 699 && bank.coordY === 99,
      ),
    ).toBe(true);
  });
});
