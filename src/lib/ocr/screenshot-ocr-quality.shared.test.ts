import { describe, expect, it } from "vitest";

import {
  classifyScreenshotLayout,
  computeThpScreenshotQuality,
} from "@/lib/ocr/screenshot-ocr-quality.shared";
import type { ThpBreakdown } from "@/lib/thp/my-thp.shared";

const EMPTY_PHASE_TIMINGS = {
  preprocessMs: 0,
  modalDetectMs: 0,
  labelOcrMs: 0,
  valueOcrMs: 0,
  headerOcrMs: 0,
  zipMs: 0,
  totalMs: 0,
};

describe("classifyScreenshotLayout", () => {
  it("classifies common aspect ratios", () => {
    expect(classifyScreenshotLayout(1080, 1920)).toBe("mobile_portrait");
    expect(classifyScreenshotLayout(1200, 1200)).toBe("pc_portrait");
    expect(classifyScreenshotLayout(1920, 1080)).toBe("widescreen");
  });
});

describe("computeThpScreenshotQuality", () => {
  it("flags too_few_ocr_lines when raw line count is low", () => {
    const metrics = computeThpScreenshotQuality({
      heroPowerTotal: 166_581_498,
      breakdown: {},
      complete: false,
      pairedCount: 2,
      unmatchedValueLineCount: 0,
      maxZipYNormDistance: 0.02,
      headerSource: "grey_bar",
      sourceWidth: 1080,
      sourceHeight: 1920,
      modalRect: { left: 60, top: 200, width: 950, height: 1050 },
      modalMethod: "grey_cc",
      modalDetectConfidence: 0.8,
      cropCandidateScores: [],
      rawLineCount: 5,
      labelLineCount: 2,
      valueLineCount: 2,
      invertedValueLineCount: 1,
      headerLineCount: 0,
      phaseTimings: EMPTY_PHASE_TIMINGS,
      reconciledFromSum: false,
    });
    expect(metrics.failureCodes).toContain("too_few_ocr_lines");
  });

  it("flags crop_misaligned when modal confidence is low", () => {
    const metrics = computeThpScreenshotQuality({
      heroPowerTotal: 166_581_498,
      breakdown: { heroLevel: 87_659_312 } as Partial<ThpBreakdown>,
      complete: false,
      pairedCount: 3,
      unmatchedValueLineCount: 0,
      maxZipYNormDistance: 0.03,
      headerSource: "grey_bar",
      sourceWidth: 1080,
      sourceHeight: 1920,
      modalRect: { left: 60, top: 200, width: 950, height: 1050 },
      modalMethod: "fallback_preset",
      modalDetectConfidence: 0.2,
      cropCandidateScores: [{ method: "fallback_preset", labelHits: 1, score: 0.2 }],
      rawLineCount: 20,
      labelLineCount: 8,
      valueLineCount: 8,
      invertedValueLineCount: 3,
      headerLineCount: 1,
      phaseTimings: EMPTY_PHASE_TIMINGS,
      reconciledFromSum: false,
    });
    expect(metrics.failureCodes).toContain("crop_misaligned");
  });

  it("flags sum_mismatch when complete is false and delta exceeds tolerance", () => {
    const breakdown = {
      heroLevel: 87_659_312,
      decorationsAndBuildings: 37_983_637,
      gear: 13_383_341,
      exclusiveWeapons: 9_459_898,
      heroTier: 6_960_050,
      heroSkill: 6_525_560,
      wallOfHonor: 4_609_700,
    } satisfies Partial<ThpBreakdown>;

    const metrics = computeThpScreenshotQuality({
      heroPowerTotal: 200_000_000,
      breakdown,
      complete: false,
      pairedCount: 7,
      unmatchedValueLineCount: 0,
      maxZipYNormDistance: 0.04,
      headerSource: "grey_bar",
      sourceWidth: 1080,
      sourceHeight: 1920,
      modalRect: { left: 60, top: 200, width: 950, height: 1050 },
      modalMethod: "grey_cc",
      modalDetectConfidence: 0.75,
      cropCandidateScores: [],
      rawLineCount: 24,
      labelLineCount: 10,
      valueLineCount: 10,
      invertedValueLineCount: 3,
      headerLineCount: 1,
      phaseTimings: EMPTY_PHASE_TIMINGS,
      reconciledFromSum: false,
    });
    expect(metrics.failureCodes).toContain("sum_mismatch");
    expect(metrics.sumDelta).toBeGreaterThan(1);
  });

  it("flags header_ratio_implausible when reconciled from sum", () => {
    const metrics = computeThpScreenshotQuality({
      heroPowerTotal: 166_581_498,
      breakdown: { heroLevel: 87_659_312 } as Partial<ThpBreakdown>,
      complete: true,
      pairedCount: 7,
      unmatchedValueLineCount: 0,
      maxZipYNormDistance: 0.03,
      headerSource: "reconciled_sum",
      sourceWidth: 1080,
      sourceHeight: 1920,
      modalRect: { left: 60, top: 200, width: 950, height: 1050 },
      modalMethod: "grey_cc",
      modalDetectConfidence: 0.8,
      cropCandidateScores: [],
      rawLineCount: 24,
      labelLineCount: 10,
      valueLineCount: 10,
      invertedValueLineCount: 3,
      headerLineCount: 1,
      phaseTimings: EMPTY_PHASE_TIMINGS,
      reconciledFromSum: true,
    });
    expect(metrics.failureCodes).toContain("header_ratio_implausible");
  });
});
