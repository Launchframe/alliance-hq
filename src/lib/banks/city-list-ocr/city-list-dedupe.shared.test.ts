import { describe, expect, it } from "vitest";

import {
  coalesceCityListBanks,
  mergeCityListOcrPasses,
  mergeCityListParses,
  shouldRunCityListGreenOcrPass,
} from "@/lib/banks/city-list-ocr/city-list-dedupe.shared";
import type { ParsedCityListBank } from "@/lib/banks/city-list-ocr/parse-city-list-text.shared";
import { parseCityListText } from "@/lib/banks/city-list-ocr/parse-city-list-text.shared";

function bank(
  partial: Partial<ParsedCityListBank> &
    Pick<ParsedCityListBank, "coordX" | "coordY">,
): ParsedCityListBank {
  return {
    level: partial.level ?? 2,
    crystalGoldValue:
      partial.crystalGoldValue === undefined
        ? 600_000
        : partial.crystalGoldValue,
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

  it("fills null crystalGoldValue from a sibling tile", () => {
    const merged = coalesceCityListBanks([
      bank({ coordX: 699, coordY: 499, crystalGoldValue: null }),
      bank({ coordX: 699, coordY: 499, crystalGoldValue: 486_000 }),
    ]);
    expect(merged.crystalGoldValue).toBe(486_000);
  });

  it("prefers a recovered level over the default placeholder level 1", () => {
    const merged = coalesceCityListBanks([
      bank({ coordX: 499, coordY: 799, level: 1, crystalGoldValue: null }),
      bank({
        coordX: 499,
        coordY: 799,
        level: 3,
        crystalGoldValue: 588_000,
      }),
    ]);
    expect(merged.level).toBe(3);
    expect(merged.crystalGoldValue).toBe(588_000);
  });

  it("does not escalate a recovered level when OCR passes disagree", () => {
    const merged = coalesceCityListBanks([
      bank({
        coordX: 699,
        coordY: 299,
        level: 2,
        crystalGoldValue: 600_000,
        currentDepositCount: null,
      }),
      bank({
        coordX: 699,
        coordY: 299,
        level: 8,
        crystalGoldValue: null,
        currentDepositCount: null,
      }),
    ]);
    expect(merged.level).toBe(2);
    expect(merged.crystalGoldValue).toBe(600_000);
  });
});

describe("shouldRunCityListGreenOcrPass", () => {
  it("skips the green pass when the primary parse is already complete", () => {
    expect(shouldRunCityListGreenOcrPass({ isComplete: true })).toBe(false);
    expect(shouldRunCityListGreenOcrPass({ isComplete: false })).toBe(true);
  });
});

describe("mergeCityListOcrPasses", () => {
  it("absorbs ±1 coordinate drift from the green pass without extra tiles", () => {
    const primary = parseCityListText([
      "Bank Strongholds captured: 2/8",
      "600.00K 486.00K",
      "#1211 (X:699, Y:299) #1211 (X:699, Y:99)",
    ]);
    const green = parseCityListText([
      "600.00K 486.00K",
      "Lv.3 Lv.2",
      "#1211 (X:699, Y:298) #1211 (X:699, Y:99)",
    ]);
    const merged = mergeCityListOcrPasses(primary, green);
    expect(merged.banks).toHaveLength(2);
    expect(
      merged.banks.find((b) => b.coordX === 699 && b.coordY === 299),
    ).toMatchObject({
      level: 3,
      crystalGoldValue: 600_000,
    });
    expect(
      merged.banks.some((b) => b.coordX === 699 && b.coordY === 99),
    ).toBe(true);
  });

  it("merges a drifted tile onto the nearest primary, not the first in-tolerance", () => {
    const primary = parseCityListText([
      "Bank Strongholds captured: 2/8",
      "600.00K 500.00K",
      "Lv.2 Lv.2",
      "#1211 (X:699, Y:100) #1211 (X:699, Y:103)",
    ]);
    const green = parseCityListText([
      "600.00K",
      "Lv.3",
      "#1211 (X:699, Y:102)",
    ]);
    const merged = mergeCityListOcrPasses(primary, green);
    expect(merged.banks).toHaveLength(2);
    expect(
      merged.banks.find((b) => b.coordX === 699 && b.coordY === 103),
    ).toMatchObject({
      level: 2,
      crystalGoldValue: 500_000,
    });
    // Y:102 is closer to Y:103 than Y:100; first-match would have hit Y:100.
    expect(
      merged.banks.find((b) => b.coordX === 699 && b.coordY === 100),
    ).toMatchObject({
      level: 2,
      crystalGoldValue: 600_000,
    });
    // Green Lv.3 must not escalate the recovered Lv.2 on the nearest tile.
    expect(merged.banks.every((b) => b.level === 2)).toBe(true);
  });

  it("recovers a missing top row in its correct screen position, not appended after a coordinate sort", () => {
    const primary = parseCityListText([
      "Bank Strongholds captured: 6/8",
      "492.00K 357.62K 354.00K",
      "Lv.3 Lv.3 Lv.3",
      "#1203 [X:499, Y:599] #1203 [X:599, Y:499] #1203 [X:599, Y:399]",
    ]);
    const green = parseCityListText([
      "588.00K 447.38K 522.00K",
      "Lv.3 Lv.3 Lv.3",
      "#1203 [X:499, Y:799] #1203 [X:499, Y:699] #1203 [X:599, Y:599]",
      "492.00K 357.62K 354.00K",
      "#1203 [X:499, Y:599] #1203 [X:599, Y:499] #1203 [X:599, Y:399]",
    ]);
    const merged = mergeCityListOcrPasses(primary, green);
    expect(merged.banks).toHaveLength(6);
    expect(merged.isComplete).toBe(true);
    // Green recovered all 6 tiles (primary only found the bottom 3), so green's
    // own reading order — recovered top row first, then the bottom row — wins
    // as the position backbone. A game-coordinate sort would not reliably put
    // the top row first (map X/Y are not screen pixel positions).
    expect(
      merged.banks.map((b) => `${b.coordX}:${b.coordY}`),
    ).toEqual(["499:799", "499:699", "599:599", "499:599", "599:499", "599:399"]);
  });

  it("keeps the more-complete pass's order as backbone even when it runs second", () => {
    // Primary (greyscale) finds all 6 tiles in reading order; the green pass
    // only re-confirms 2 of them (e.g. a low-confidence recovery run). Primary
    // stays the backbone since it is the more complete read.
    const primary = parseCityListText([
      "Bank Strongholds captured: 6/8",
      "588.00K 447.38K 522.00K",
      "Lv.3 Lv.3 Lv.3",
      "#1203 [X:499, Y:799] #1203 [X:499, Y:699] #1203 [X:599, Y:599]",
      "492.00K 357.62K 354.00K",
      "#1203 [X:499, Y:599] #1203 [X:599, Y:499] #1203 [X:599, Y:399]",
    ]);
    const green = parseCityListText([
      "492.00K 354.00K",
      "Lv.3 Lv.3",
      "#1203 [X:499, Y:599] #1203 [X:599, Y:399]",
    ]);
    const merged = mergeCityListOcrPasses(primary, green);
    expect(merged.banks).toHaveLength(6);
    expect(
      merged.banks.map((b) => `${b.coordX}:${b.coordY}`),
    ).toEqual(["499:799", "499:699", "599:599", "499:599", "599:499", "599:399"]);
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

  it("preserves each screenshot's on-screen reading order instead of sorting by game coordinates", () => {
    // Map X/Y do not increase left-to-right/top-to-bottom on screen — this
    // shot's reading order is deliberately non-monotonic in X/Y so a
    // coordinate sort would visibly scramble it.
    const shotA = parseCityListText([
      "Bank Strongholds captured: 6/8",
      "600.00K 500.00K 400.00K",
      "Lv.3 Lv.2 Lv.1",
      "#1211 (X:900, Y:50) #1211 (X:100, Y:900) #1211 (X:500, Y:500)",
    ]);
    // A second, non-overlapping screenshot — its new tiles append after
    // shotA's tiles, each still in that screenshot's own reading order.
    const shotB = parseCityListText([
      "Bank Strongholds captured: 6/8",
      "300.00K 200.00K 100.00K",
      "Lv.2 Lv.2 Lv.1",
      "#1211 (X:700, Y:20) #1211 (X:20, Y:700) #1211 (X:300, Y:300)",
    ]);

    const { snapshot } = mergeCityListParses([shotA, shotB]);
    expect(snapshot.banks).toHaveLength(6);
    expect(snapshot.banks.map((b) => `${b.coordX}:${b.coordY}`)).toEqual([
      "900:50",
      "100:900",
      "500:500",
      "700:20",
      "20:700",
      "300:300",
    ]);
  });

  it("keeps an overlapping tile at its first-encountered position", () => {
    const shotA = parseCityListText([
      "Bank Strongholds captured: 3/8",
      "600.00K 500.00K 400.00K",
      "Lv.3 Lv.2 Lv.1",
      "#1211 (X:900, Y:50) #1211 (X:100, Y:900) #1211 (X:500, Y:500)",
    ]);
    // Re-shot with the middle tile overlapping shotA — the merged tile must
    // stay in shotA's position (index 1), not move to wherever shotB's own
    // reading order would otherwise place it.
    const shotB = parseCityListText([
      "Bank Strongholds captured: 3/8",
      "500.00K",
      "Lv.2",
      "#1211 (X:100, Y:900)",
    ]);

    const { snapshot, dedupeReport } = mergeCityListParses([shotA, shotB]);
    expect(snapshot.banks).toHaveLength(3);
    expect(snapshot.banks.map((b) => `${b.coordX}:${b.coordY}`)).toEqual([
      "900:50",
      "100:900",
      "500:500",
    ]);
    expect(dedupeReport.autoMergedCount).toBe(1);
  });
});
