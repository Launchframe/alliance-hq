import { sumThpBreakdown, THP_BREAKDOWN_KEYS } from "@/lib/thp/breakdown.shared";
import type { ThpBreakdown } from "@/lib/thp/my-thp.shared";
import { THP_OFFICER_REVIEW_THRESHOLD } from "@/lib/thp/constants";
import {
  isPlausibleHeroPowerHeaderTotal,
} from "@/lib/thp/hero-power-ocr/parse-power-details-geometry.shared";
import type { CropRect } from "@/lib/ocr/game-modal-detect.shared";

export type ScreenshotOcrFailureCode =
  | "crop_misaligned"
  | "row_shift"
  | "header_ratio_implausible"
  | "sum_mismatch"
  | "header_digit_noise"
  | "too_few_ocr_lines"
  | "unmatched_value_lines"
  | "anomaly_threshold"
  | "user_rejected";

export type ScreenshotOcrLayoutClass =
  | "mobile_portrait"
  | "pc_portrait"
  | "widescreen"
  | "unknown";

export type CropCandidateScore = {
  method: string;
  labelHits: number;
  score: number;
};

export type ScreenshotOcrQualityMetrics = {
  parsedOk: boolean;
  complete: boolean;
  failureCodes: ScreenshotOcrFailureCode[];
  pairedCount: number;
  expectedPairCount: number;
  unmatchedValueLineCount: number;
  maxZipYNormDistance: number;
  headerToHeroLevelRatio: number | null;
  headerTotal: number | null;
  componentSum: number | null;
  sumDelta: number | null;
  headerSource: "grey_bar" | "reconciled_sum" | "probe" | null;
  layoutClass: ScreenshotOcrLayoutClass;
  aspectRatio: number;
  modalAreaFraction: number | null;
  modalDetectConfidence: number | null;
  modalMethod: string | null;
  cropCandidateScores: CropCandidateScore[];
  rawLineCount: number;
  labelLineCount: number;
  valueLineCount: number;
  invertedValueLineCount: number;
  headerLineCount: number;
  phaseTimings: {
    preprocessMs: number;
    modalDetectMs: number;
    labelOcrMs: number;
    valueOcrMs: number;
    headerOcrMs: number;
    zipMs: number;
    totalMs: number;
  };
  userConfirmed: boolean | null;
  userRejectedReason: string | null;
};

export function classifyScreenshotLayout(
  width: number,
  height: number,
): ScreenshotOcrLayoutClass {
  const ratio = width / Math.max(1, height);
  if (ratio >= 1.45) return "widescreen";
  if (ratio >= 0.85 && ratio <= 1.15) return "pc_portrait";
  if (ratio < 0.75) return "mobile_portrait";
  return "unknown";
}

export function computeThpScreenshotQuality(input: {
  heroPowerTotal: number | null;
  breakdown: Partial<ThpBreakdown>;
  complete: boolean;
  pairedCount: number;
  unmatchedValueLineCount: number;
  maxZipYNormDistance: number;
  headerSource: ScreenshotOcrQualityMetrics["headerSource"];
  sourceWidth: number;
  sourceHeight: number;
  modalRect: CropRect | null;
  modalMethod: string | null;
  modalDetectConfidence: number | null;
  cropCandidateScores: CropCandidateScore[];
  rawLineCount: number;
  labelLineCount: number;
  valueLineCount: number;
  invertedValueLineCount: number;
  headerLineCount: number;
  phaseTimings: ScreenshotOcrQualityMetrics["phaseTimings"];
  reconciledFromSum: boolean;
}): ScreenshotOcrQualityMetrics {
  const failureCodes: ScreenshotOcrFailureCode[] = [];
  const heroLevel = input.breakdown.heroLevel ?? null;
  const componentSum =
    Object.keys(input.breakdown).length > 0
      ? sumThpBreakdown(input.breakdown as ThpBreakdown)
      : null;
  const headerTotal = input.heroPowerTotal;
  const sumDelta =
    headerTotal != null && componentSum != null
      ? Math.abs(headerTotal - componentSum)
      : null;

  if (input.rawLineCount < 8) failureCodes.push("too_few_ocr_lines");
  if (input.pairedCount < 4 || (input.modalDetectConfidence ?? 1) < 0.35) {
    failureCodes.push("crop_misaligned");
  }
  if (input.unmatchedValueLineCount > 0) {
    failureCodes.push("unmatched_value_lines");
  }
  if (
    headerTotal != null &&
    heroLevel != null &&
    !isPlausibleHeroPowerHeaderTotal(headerTotal, heroLevel)
  ) {
    failureCodes.push("header_ratio_implausible");
  }
  if (!input.complete && sumDelta != null && sumDelta > 1) {
    failureCodes.push("sum_mismatch");
  }
  if (headerTotal != null && String(headerTotal).length > 9) {
    failureCodes.push("header_digit_noise");
  }
  if (input.pairedCount >= 2 && input.pairedCount < 5) {
    failureCodes.push("row_shift");
  }
  if (headerTotal != null && headerTotal > THP_OFFICER_REVIEW_THRESHOLD) {
    failureCodes.push("anomaly_threshold");
  }
  if (input.reconciledFromSum) {
    failureCodes.push("header_ratio_implausible");
  }

  const modalAreaFraction =
    input.modalRect != null
      ? (input.modalRect.width * input.modalRect.height) /
        Math.max(1, input.sourceWidth * input.sourceHeight)
      : null;

  const headerToHeroLevelRatio =
    headerTotal != null && heroLevel != null && heroLevel > 0
      ? headerTotal / heroLevel
      : null;

  const parsedOk =
    headerTotal != null &&
    input.pairedCount >= 4 &&
    !failureCodes.includes("crop_misaligned");

  return {
    parsedOk,
    complete: input.complete,
    failureCodes: [...new Set(failureCodes)],
    pairedCount: input.pairedCount,
    expectedPairCount: THP_BREAKDOWN_KEYS.length,
    unmatchedValueLineCount: input.unmatchedValueLineCount,
    maxZipYNormDistance: input.maxZipYNormDistance,
    headerToHeroLevelRatio,
    headerTotal,
    componentSum,
    sumDelta,
    headerSource: input.headerSource,
    layoutClass: classifyScreenshotLayout(input.sourceWidth, input.sourceHeight),
    aspectRatio: input.sourceWidth / Math.max(1, input.sourceHeight),
    modalAreaFraction,
    modalDetectConfidence: input.modalDetectConfidence,
    modalMethod: input.modalMethod,
    cropCandidateScores: input.cropCandidateScores,
    rawLineCount: input.rawLineCount,
    labelLineCount: input.labelLineCount,
    valueLineCount: input.valueLineCount,
    invertedValueLineCount: input.invertedValueLineCount,
    headerLineCount: input.headerLineCount,
    phaseTimings: input.phaseTimings,
    userConfirmed: null,
    userRejectedReason: null,
  };
}
