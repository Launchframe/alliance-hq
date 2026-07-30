import { describe, expect, it } from "vitest";

import {
  buildScreenshotHygieneCoachTip,
  SCREENSHOT_HYGIENE_COACH_CROP_MISALIGNED_STREAK,
} from "@/lib/ocr/screenshot-hygiene-coach.shared";

describe("buildScreenshotHygieneCoachTip", () => {
  it("surfaces crop misaligned coach tip after streak threshold", () => {
    const tip = buildScreenshotHygieneCoachTip({
      cropMisalignedStreak: SCREENSHOT_HYGIENE_COACH_CROP_MISALIGNED_STREAK,
      latestFailureCodes: ["crop_misaligned"],
    });
    expect(tip).toMatch(/Center the Power Details modal/i);
  });

  it("returns null when quality looks healthy", () => {
    expect(
      buildScreenshotHygieneCoachTip({
        cropMisalignedStreak: 0,
        latestFailureCodes: [],
      }),
    ).toBeNull();
  });
});
