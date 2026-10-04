import { describe, expect, it } from "vitest";

import {
  OCR_ACCURACY_LEVELS,
  displayOcrAccuracy,
  isVideoOcrAccuracy,
  resolveOcrAccuracyBadge,
} from "@/lib/video/ocr-accuracy";

describe("ocr-accuracy", () => {
  it("resolves a labelKey and non-empty className for every level", () => {
    for (const level of OCR_ACCURACY_LEVELS) {
      const badge = resolveOcrAccuracyBadge(level);
      expect(badge.labelKey).toBe(`ocrAccuracy.${level}`);
      expect(badge.className.trim().length).toBeGreaterThan(0);
    }
  });

  it("uses High when Ashed credentials are active on Ashed-supported targets", () => {
    expect(
      displayOcrAccuracy({
        inHouseOcrAccuracy: "low",
        ashedCredentialsActive: true,
        ashedSupported: true,
      }),
    ).toBe("high");
    expect(
      displayOcrAccuracy({
        inHouseOcrAccuracy: "mid",
        ashedCredentialsActive: true,
        ashedSupported: false,
      }),
    ).toBe("mid");
    expect(
      displayOcrAccuracy({
        inHouseOcrAccuracy: "low",
        ashedCredentialsActive: false,
        ashedSupported: true,
      }),
    ).toBe("low");
  });

  it("uses darker text classes for light-mode contrast", () => {
    expect(resolveOcrAccuracyBadge("high").className).toContain("text-emerald-800");
    expect(resolveOcrAccuracyBadge("high").className).toContain("dark:text-emerald-300");
    expect(resolveOcrAccuracyBadge("none").className).toContain("text-hq-fg-muted");
  });

  it("narrows known accuracy strings", () => {
    expect(isVideoOcrAccuracy("high")).toBe(true);
    expect(isVideoOcrAccuracy("mid")).toBe(true);
    expect(isVideoOcrAccuracy("low")).toBe(true);
    expect(isVideoOcrAccuracy("none")).toBe(true);
    expect(isVideoOcrAccuracy("unknown")).toBe(false);
    expect(isVideoOcrAccuracy(null)).toBe(false);
  });
});
