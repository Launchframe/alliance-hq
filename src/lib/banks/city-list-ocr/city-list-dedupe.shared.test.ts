import { describe, expect, it } from "vitest";

import {
  coalesceCityListBanks,
  mergeCityListParses,
} from "@/lib/banks/city-list-ocr/city-list-dedupe.shared";
import type { ParsedCityListBank } from "@/lib/banks/city-list-ocr/parse-city-list-text.shared";
import { parseCityListText } from "@/lib/banks/city-list-ocr/parse-city-list-text.shared";

function bank(
  partial: Partial<ParsedCityListBank> &
    Pick<ParsedCityListBank, "coordX" | "coordY">,
): ParsedCityListBank {
  return {
    level: partial.level ?? 2,
    crystalGoldValue: partial.crystalGoldValue ?? 600_000,
    gameServerNumber: partial.gameServerNumber ?? 1211,
    coordX: partial.coordX,
    coordY: partial.coordY,
    currentDepositCount:
      partial.currentDepositCount === undefined
        ? 100
        : partial.currentDepositCount,
  };
}

describe("coalesceCityListBanks", () => {
  it("fills null deposit count from a sibling tile", () => {
    const merged = coalesceCityListBanks([
      bank({ coordX: 599, coordY: 499, currentDepositCount: null }),
      bank({ coordX: 599, coordY: 499, currentDepositCount: 81 }),
    ]);
    expect(merged.currentDepositCount).toBe(81);
  });
});

describe("mergeCityListParses", () => {
  it("dedupes overlapping screenshots by server+coords and marks complete", () => {
    const shotA = parseCityListText([
      "Total CrystalGold Deposited: 3.48M Bank Strongholds captured: 6/8",
      "600.00K 600.00K 600.00K",
      "Lv.3 Lv.2 Lv.2",
      "#1211 (X:599, Y:499) #1211 (X:699, Y:599) #1211 (X:699, Y:499)",
      "100/100 100/100 100/100",
      "Server Time: 2026-7-11 16:57:24",
      "Bank Stronghold captures left today: 2/2",
    ]);
    const shotB = parseCityListText([
      "Bank Strongholds captured: 6/8",
      "600.00K 599.96K 597.26K 486.00K",
      "Lv.2 Lv.2 Lv.2 Lv.2",
      "#1211 (X:699, Y:499) #1211 (X:699, Y:399) #1211 (X:699, Y:299) #1211 (X:699, Y:99)",
      "100/100 100/100 100/100 81/100",
    ]);

    const { snapshot, dedupeReport } = mergeCityListParses([shotA, shotB]);
    expect(snapshot.banks).toHaveLength(6);
    expect(snapshot.isComplete).toBe(true);
    expect(snapshot.capturedCount).toBe(6);
    expect(snapshot.totalCrystalGoldDeposited).toBe(3_480_000);
    expect(snapshot.serverTime).toBe("2026-07-11T16:57:24.000Z");
    // One overlapping tile (699,499) appears in both shots.
    expect(dedupeReport.autoMergedCount).toBe(1);
  });

  it("keeps incomplete when merged tiles still miss the captured count", () => {
    const shotA = parseCityListText([
      "Bank Strongholds captured: 8/8",
      "600.00K",
      "Lv.2",
      "#1211 (X:100, Y:100)",
      "10/100",
    ]);
    const shotB = parseCityListText([
      "Bank Strongholds captured: 8/8",
      "500.00K",
      "Lv.3",
      "#1211 (X:200, Y:200)",
      "20/100",
    ]);
    const { snapshot } = mergeCityListParses([shotA, shotB]);
    expect(snapshot.banks).toHaveLength(2);
    expect(snapshot.isComplete).toBe(false);
  });
});
