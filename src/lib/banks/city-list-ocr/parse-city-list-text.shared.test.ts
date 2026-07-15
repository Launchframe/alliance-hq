import { describe, expect, it } from "vitest";

import {
  clampOcrDepositCount,
  parseCityListBanks,
  parseCityListFooter,
  parseCityListHeader,
  parseCityListServerTime,
  parseCityListText,
  parseCompactCrystalGoldValue,
} from "@/lib/banks/city-list-ocr/parse-city-list-text.shared";
import { bankDepositCapacity } from "@/lib/banks/types.shared";

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

  it("restores a lost decimal before the K suffix", () => {
    expect(parseCompactCrystalGoldValue("59726", "K")).toBe(597_260);
    expect(parseCompactCrystalGoldValue("59996", "K")).toBe(599_960);
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

  it("keeps value/coord zip row-local when the first row misses a K amount", () => {
    // Global index-zip would assign 599.96K to the third tile of row 1.
    const banks = parseCityListBanks([
      "600.00K 600.00K",
      "Lv.3 Lv.2 Lv.2",
      "#1211 (X:1, Y:1) #1211 (X:2, Y:2) #1211 (X:3, Y:3)",
      "100/100 100/100 100/100",
      "599.96K 597.26K 486.00K",
      "Lv.2 Lv.2 Lv.2",
      "#1211 (X:4, Y:4) #1211 (X:5, Y:5) #1211 (X:6, Y:6)",
      "100/100 100/100 81/100",
    ]);
    expect(banks).toHaveLength(6);
    expect(banks[0]).toMatchObject({
      crystalGoldValue: 600_000,
      coordX: 1,
      coordY: 1,
      level: 3,
      currentDepositCount: 100,
    });
    expect(banks[1]).toMatchObject({
      crystalGoldValue: 600_000,
      coordX: 2,
      coordY: 2,
      level: 2,
    });
    expect(banks[2]).toMatchObject({
      crystalGoldValue: null,
      coordX: 3,
      coordY: 3,
      level: 2,
      currentDepositCount: 100,
    });
    expect(banks[3]).toMatchObject({
      crystalGoldValue: 599_960,
      coordX: 4,
      coordY: 4,
    });
    expect(banks[4]).toMatchObject({
      crystalGoldValue: 597_260,
      coordX: 5,
      coordY: 5,
    });
    expect(banks[5]).toMatchObject({
      crystalGoldValue: 486_000,
      coordX: 6,
      coordY: 6,
      currentDepositCount: 81,
    });
  });

  it("does not carry a leftover first-row amount into the next coord row", () => {
    // Three amounts recovered for a two-tile coord row — extra amount stays
    // local to that row (dropped), not shifted onto the following tile.
    const banks = parseCityListBanks([
      "600.00K 500.00K 400.00K",
      "#1211 (X:1, Y:1) #1211 (X:2, Y:2)",
      "300.00K",
      "#1211 (X:3, Y:3)",
    ]);
    expect(banks).toHaveLength(3);
    expect(banks[0]).toMatchObject({
      crystalGoldValue: 600_000,
      coordX: 1,
      coordY: 1,
    });
    expect(banks[1]).toMatchObject({
      crystalGoldValue: 500_000,
      coordX: 2,
      coordY: 2,
    });
    expect(banks[2]).toMatchObject({
      crystalGoldValue: 300_000,
      coordX: 3,
      coordY: 3,
    });
  });

  it("recovers Lv:3 / Lvi3 tokens and hashless coordinate labels", () => {
    const banks = parseCityListBanks([
      "588.00K 447 38K 522 00N",
      "Lv:3 Lvi3 Lv.3",
      "1203 [X:499, Y:799] 1203 [X:499, Y:699] #1203 [X:599, Y:599]",
      "98/100 75/100 87/100",
    ]);
    expect(banks).toHaveLength(3);
    expect(banks[0]).toMatchObject({
      level: 3,
      crystalGoldValue: 588_000,
      gameServerNumber: 1203,
      coordX: 499,
      coordY: 799,
      currentDepositCount: 98,
    });
    expect(banks[1]).toMatchObject({
      level: 3,
      crystalGoldValue: 447_380,
      coordX: 499,
      coordY: 699,
      currentDepositCount: 75,
    });
    expect(banks[2]).toMatchObject({
      level: 3,
      crystalGoldValue: 522_000,
      coordX: 599,
      coordY: 599,
      currentDepositCount: 87,
    });
  });

  it("recovers glued server+X coordinates when the X label is dropped", () => {
    const banks = parseCityListBanks([
      "600.00K",
      "Lv 3",
      "(#1211599, V:499)",
    ]);
    expect(banks).toEqual([
      {
        level: 3,
        crystalGoldValue: 600_000,
        gameServerNumber: 1211,
        coordX: 599,
        coordY: 499,
        currentDepositCount: null,
      },
    ]);
  });

  it("prefers a 3-digit server split for short glued server+X tokens", () => {
    const banks = parseCityListBanks([
      "500.00K",
      "Lv.2",
      "(#999599, V:100)",
    ]);
    expect(banks).toEqual([
      {
        level: 2,
        crystalGoldValue: 500_000,
        gameServerNumber: 999,
        coordX: 599,
        coordY: 100,
        currentDepositCount: null,
      },
    ]);
  });

  it("keeps 4-digit server when glued X matches a 2-digit Y magnitude", () => {
    const banks = parseCityListBanks([
      "486.00K",
      "Lv.2",
      "(#121199, V:99)",
    ]);
    expect(banks).toEqual([
      {
        level: 2,
        crystalGoldValue: 486_000,
        gameServerNumber: 1211,
        coordX: 99,
        coordY: 99,
        currentDepositCount: null,
      },
    ]);
  });

  it("keeps both grid rows when soft OCR recovers Lv: and bracket coords", () => {
    // Captured from soft-greyscale Tesseract on bank-stronghold-city-list.png.
    const banks = parseCityListBanks([
      "8 (Jeo000k B (J 60000K B & 600.00K",
      "Lv:3 (573 Lv 2!",
      "Q #1211 [X:598, Y:499) Q#1211 [X:699, Y:539) Q #1211 [X:699, Y:499]",
      "& (Js9996k @ (J59726K (J 486.00K",
      "Lv 2 Lv:2 Lv:2",
      "Q#1211[x:699,v:399)  Q)#1211(X:699,V:299) (#1211 [X:698, V:99)",
    ]);
    expect(banks).toHaveLength(6);
    expect(banks[0]).toMatchObject({
      level: 3,
      gameServerNumber: 1211,
      coordX: 598,
      coordY: 499,
    });
    expect(banks[1]).toMatchObject({ level: 2, coordX: 699, coordY: 539 });
    expect(banks[3]).toMatchObject({ level: 2, coordX: 699, coordY: 399 });
    expect(banks[5]).toMatchObject({
      level: 2,
      crystalGoldValue: 486_000,
      coordX: 698,
      coordY: 99,
    });
  });

  it("parses deposit counts from level 6+ banks with 110 capacity", () => {
    const banks = parseCityListBanks([
      "600.00K 500.00K",
      "Lv.6 Lv.7",
      "#1211 (X:599, Y:499) #1211 (X:699, Y:599)",
      "95/110 108/110",
    ]);
    expect(banks).toHaveLength(2);
    expect(banks[0]).toMatchObject({
      level: 6,
      crystalGoldValue: 600_000,
      currentDepositCount: 95,
    });
    expect(banks[1]).toMatchObject({
      level: 7,
      crystalGoldValue: 500_000,
      currentDepositCount: 108,
    });
  });

  it("handles mixed 100 and 110 deposit capacities in the same row", () => {
    const banks = parseCityListBanks([
      "600.00K 500.00K 400.00K",
      "Lv.3 Lv.6 Lv.2",
      "#1211 (X:1, Y:1) #1211 (X:2, Y:2) #1211 (X:3, Y:3)",
      "81/100 95/110 50/100",
    ]);
    expect(banks).toHaveLength(3);
    expect(banks[0]?.currentDepositCount).toBe(81);
    expect(banks[1]?.currentDepositCount).toBe(95);
    expect(banks[2]?.currentDepositCount).toBe(50);
  });

  it("does not misassign an orphaned row's amounts when its own coordinate line is fully unreadable", () => {
    // The middle tile-row's coordinate line is completely unreadable (no
    // match on either the labeled or glued coordinate patterns), so it has
    // zero coords and drops out of `coordLineIndices`. Its value/level
    // lines land in the next row's pre-line window and must be discarded,
    // not zipped onto the next row's real coordinates.
    const banks = parseCityListBanks([
      "600.00K",
      "Lv.3",
      "#1211 (X:1, Y:1)",
      "500.00K",
      "Lv.2",
      "unreadable garbage with no coordinate pattern at all",
      "400.00K",
      "Lv.4",
      "#1211 (X:3, Y:3)",
    ]);
    expect(banks).toHaveLength(2);
    expect(banks[0]).toMatchObject({
      crystalGoldValue: 600_000,
      coordX: 1,
      coordY: 1,
      level: 3,
    });
    expect(banks[1]).toMatchObject({
      crystalGoldValue: 400_000,
      coordX: 3,
      coordY: 3,
      level: 4,
    });
  });

  it("recovers a top row that only appears as hashless coords (bottom-row regression)", () => {
    // Live review UI lost the top row while keeping bottom-row #1203 tiles.
    const banks = parseCityListBanks([
      "588.00K 447.38K 522.00K",
      "Lv.3 Lv.3 Lv.3",
      "1203 [X:499, Y:799] 1203 [X:499, Y:699] 1203 [X:599, Y:599]",
      "98/100 75/100 87/100",
      "492.00K 357.62K 354.00K",
      "Lv.3 Lv.3 Lv.3",
      "#1203 [X:499, Y:599] #1203 [X:599, Y:499] #1203 [X:599, Y:399]",
      "82/100 60/100 59/100",
    ]);
    expect(banks).toHaveLength(6);
    expect(banks.map((b) => `${b.coordX},${b.coordY}`)).toEqual([
      "499,799",
      "499,699",
      "599,599",
      "499,599",
      "599,499",
      "599,399",
    ]);
    expect(banks.every((b) => b.level === 3)).toBe(true);
    expect(banks[0]?.crystalGoldValue).toBe(588_000);
    expect(banks[5]?.crystalGoldValue).toBe(354_000);
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

  it("marks incomplete when captured count is unavailable", () => {
    const snapshot = parseCityListText([
      "600.00K",
      "Lv.2",
      "#1211 (X:599, Y:499)",
      "100/100",
    ]);
    expect(snapshot.capturedCount).toBeNull();
    expect(snapshot.banks).toHaveLength(1);
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

describe("clampOcrDepositCount", () => {
  it("returns values already within capacity unchanged", () => {
    expect(clampOcrDepositCount(0)).toBe(0);
    expect(clampOcrDepositCount(81)).toBe(81);
    expect(clampOcrDepositCount(100)).toBe(100);
    expect(clampOcrDepositCount(110)).toBe(110);
  });

  it("strips leading digits when OCR prepends junk (271 → 71)", () => {
    expect(clampOcrDepositCount(271)).toBe(71);
  });

  it("strips multiple leading digits if needed (1200 → 00 → 0)", () => {
    expect(clampOcrDepositCount(1200)).toBe(0);
  });

  it("handles values just above the cap (111 → 11)", () => {
    expect(clampOcrDepositCount(111)).toBe(11);
  });

  it("handles a three-digit result after one strip (395 → 95)", () => {
    expect(clampOcrDepositCount(395)).toBe(95);
  });
});

describe("parseCityListBanks — deposit clamping", () => {
  it("clamps OCR deposit counts above 110 by stripping leading digits", () => {
    const banks = parseCityListBanks([
      "600.00K 500.00K",
      "Lv.3 Lv.6",
      "#1211 (X:1, Y:1) #1211 (X:2, Y:2)",
      "271/100 395/110",
    ]);
    expect(banks).toHaveLength(2);
    expect(banks[0]?.currentDepositCount).toBe(71);
    expect(banks[1]?.currentDepositCount).toBe(95);
  });
});

describe("bankDepositCapacity", () => {
  it("returns 100 for levels 1–5", () => {
    for (let level = 1; level <= 5; level++) {
      expect(bankDepositCapacity(level)).toBe(100);
    }
  });

  it("returns 110 for level 6", () => {
    expect(bankDepositCapacity(6)).toBe(110);
  });

  it("returns 110 for levels 7 and above", () => {
    expect(bankDepositCapacity(7)).toBe(110);
    expect(bankDepositCapacity(10)).toBe(110);
  });
});
