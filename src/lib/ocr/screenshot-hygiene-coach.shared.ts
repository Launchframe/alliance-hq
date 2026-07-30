import type { ScreenshotOcrFailureCode } from "@/lib/ocr/screenshot-ocr-quality.shared";

export const SCREENSHOT_HYGIENE_COACH_CROP_MISALIGNED_STREAK = 2;

export function buildScreenshotHygieneCoachTip(input: {
  cropMisalignedStreak: number;
  latestFailureCodes: ScreenshotOcrFailureCode[];
}): string | null {
  if (
    input.cropMisalignedStreak >= SCREENSHOT_HYGIENE_COACH_CROP_MISALIGNED_STREAK
  ) {
    return "Center the Power Details modal in your screenshot — recent uploads were missing paired rows.";
  }
  if (input.latestFailureCodes.includes("sum_mismatch")) {
    return "OCR could not reconcile the hero power header with component rows — scroll so the full modal is visible.";
  }
  return null;
}
