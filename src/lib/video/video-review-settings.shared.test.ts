import { describe, expect, it } from "vitest";

import {
  DEFAULT_VIDEO_REVIEW_SETTINGS,
  parseVideoReviewSettings,
} from "@/lib/video/video-review-settings.shared";

describe("parseVideoReviewSettings", () => {
  it("defaults both toggles to true when keys are missing", () => {
    expect(parseVideoReviewSettings("{}")).toEqual(
      DEFAULT_VIDEO_REVIEW_SETTINGS,
    );
  });

  it("preserves explicit false values", () => {
    expect(
      parseVideoReviewSettings(
        JSON.stringify({
          fillMissingDepositTimes: false,
          fillMissingDepositAmounts: false,
        }),
      ),
    ).toEqual({
      fillMissingDepositTimes: false,
      fillMissingDepositAmounts: false,
    });
  });

  it("returns null for invalid JSON", () => {
    expect(parseVideoReviewSettings("{")).toBeNull();
  });
});
