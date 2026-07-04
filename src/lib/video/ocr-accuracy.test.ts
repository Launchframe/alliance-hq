import { describe, expect, it } from "vitest";

import {
  OCR_ACCURACY_LEVELS,
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

  it("narrows known accuracy strings", () => {
    expect(isVideoOcrAccuracy("high")).toBe(true);
    expect(isVideoOcrAccuracy("mid")).toBe(true);
    expect(isVideoOcrAccuracy("low")).toBe(true);
    expect(isVideoOcrAccuracy("none")).toBe(true);
    expect(isVideoOcrAccuracy("unknown")).toBe(false);
    expect(isVideoOcrAccuracy(null)).toBe(false);
  });
});
