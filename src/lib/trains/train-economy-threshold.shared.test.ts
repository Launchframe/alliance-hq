import { describe, expect, it } from "vitest";

import {
  PRICE_IS_RIGHT_MIN_VS_SCORE,
  effectiveEconomyMaxVsScore,
  isVsScoreEconomyEligible,
  normalizeTrainEconomyThresholdSettings,
  priceIsRightVsScoreRange,
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
});
