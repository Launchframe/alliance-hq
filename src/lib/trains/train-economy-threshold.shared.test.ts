import { describe, expect, it } from "vitest";

import {
  PRICE_IS_RIGHT_MIN_VS_SCORE,
  effectiveEconomyMaxVsScore,
  isVsScoreEconomyEligible,
  normalizeTrainEconomyThresholdSettings,
  priceIsRightVsScoreRange,
  tpirEligiblePoolEntries,
  vsScoreForEconomyDisplay,
  vsScoreForEconomyDraw,
} from "@/lib/trains/train-economy-threshold.shared";

describe("train-economy-threshold.shared", () => {
  it("defaults fudge to 1%", () => {
    expect(normalizeTrainEconomyThresholdSettings({})).toEqual({
      thresholdPoints: null,
      fudgePct: 1,
    });
  });

  it("computes max as threshold + threshold × fudge%", () => {
    expect(effectiveEconomyMaxVsScore(10_000_000, 1)).toBe(10_100_000);
    expect(effectiveEconomyMaxVsScore(10_000_000, 10)).toBe(11_000_000);
  });

  it("qualifies scores inside [7.2M, threshold + threshold × fudge%]", () => {
    const threshold = 10_000_000;
    const fudgePct = 1;
    const { min, max } = priceIsRightVsScoreRange(threshold, fudgePct);
    expect(min).toBe(PRICE_IS_RIGHT_MIN_VS_SCORE);
    expect(max).toBe(10_100_000);

    expect(isVsScoreEconomyEligible(7_199_999, threshold, fudgePct)).toBe(false);
    expect(isVsScoreEconomyEligible(7_200_000, threshold, fudgePct)).toBe(true);
    expect(isVsScoreEconomyEligible(10_100_000, threshold, fudgePct)).toBe(true);
    expect(isVsScoreEconomyEligible(10_100_001, threshold, fudgePct)).toBe(false);
  });

  it("treats missing VS as 0 for draws and null for display", () => {
    const scores = new Map<string, number>([["known", 8_000_000]]);
    expect(vsScoreForEconomyDraw(undefined)).toBe(0);
    expect(vsScoreForEconomyDisplay(scores, "missing")).toBeNull();
    expect(vsScoreForEconomyDisplay(scores, "known")).toBe(8_000_000);
    expect(vsScoreForEconomyDisplay(null, "known")).toBeNull();
  });

  it("keeps the last unselected member eligible (pool guarantee)", () => {
    const settings = normalizeTrainEconomyThresholdSettings({
      thresholdPoints: 10_000_000,
      fudgePct: 1,
    });
    const scores = new Map<string, number>();
    const only = [{ memberId: "solo" }];
    expect(tpirEligiblePoolEntries(only, scores, settings)).toEqual(only);
  });

  it("filters multi-member pools by the economy band", () => {
    const settings = normalizeTrainEconomyThresholdSettings({
      thresholdPoints: 10_000_000,
      fudgePct: 1,
    });
    const scores = new Map<string, number>([
      ["in", 8_000_000],
      ["low", 1_000_000],
      ["high", 20_000_000],
    ]);
    const pool = [
      { memberId: "in" },
      { memberId: "low" },
      { memberId: "high" },
    ];
    expect(tpirEligiblePoolEntries(pool, scores, settings)).toEqual([
      { memberId: "in" },
    ]);
  });
});
