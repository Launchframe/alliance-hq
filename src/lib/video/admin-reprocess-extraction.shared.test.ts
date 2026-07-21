import { describe, expect, it } from "vitest";

import {
  adHocReprocessCampaignName,
  canDecreaseFps,
  canIncreaseFps,
  extractionConfigsEqual,
  normalizeExtractionConfig,
  passKeyForExtractionConfig,
  resolveAdminReprocessExtraction,
  resolveSimpleReprocessExtraction,
  stepFpsLadder,
  summarizeExtractionConfig,
} from "@/lib/video/admin-reprocess-extraction.shared";

describe("stepFpsLadder", () => {
  it("steps to denser and sparser notches", () => {
    expect(stepFpsLadder(3, "increase")).toBe(4);
    expect(stepFpsLadder(3, "decrease")).toBe(2);
    expect(stepFpsLadder(1, "decrease")).toBeNull();
    expect(stepFpsLadder(6, "increase")).toBeNull();
  });

  it("jumps off-ladder values to the next strict notch", () => {
    expect(stepFpsLadder(3.2, "increase")).toBe(4);
    expect(stepFpsLadder(3.2, "decrease")).toBe(3);
  });
});

describe("resolveSimpleReprocessExtraction", () => {
  it("keeps the current config", () => {
    const current = { mode: "fps" as const, sampleFps: 3 };
    expect(resolveSimpleReprocessExtraction(current, "keep")).toEqual({
      config: current,
      changed: false,
    });
  });

  it("increases fps_3 to fps_4", () => {
    expect(
      resolveSimpleReprocessExtraction(
        { mode: "fps", sampleFps: 3 },
        "increase",
      ),
    ).toEqual({
      config: { mode: "fps", sampleFps: 4 },
      changed: true,
    });
  });

  it("switches scene mode onto the fps ladder when increasing", () => {
    const result = resolveSimpleReprocessExtraction(
      { mode: "scene", sceneThreshold: 0.25, sampleFps: 1 },
      "increase",
    );
    expect(result.config).toEqual({ mode: "fps", sampleFps: 1.5 });
    expect(result.changed).toBe(true);
  });

  it("nearest-then-steps for off-ladder scene sampleFps", () => {
    expect(
      resolveSimpleReprocessExtraction(
        { mode: "scene", sceneThreshold: 0.25, sampleFps: 1.8 },
        "increase",
      ).config,
    ).toEqual({ mode: "fps", sampleFps: 3 });
  });

  it("no-ops increase at the top of the ladder", () => {
    expect(
      resolveSimpleReprocessExtraction(
        { mode: "fps", sampleFps: 6 },
        "increase",
      ).changed,
    ).toBe(false);
  });
});

describe("passKeyForExtractionConfig", () => {
  it("formats fps and scene keys", () => {
    expect(passKeyForExtractionConfig({ mode: "fps", sampleFps: 3 })).toBe(
      "fps_3",
    );
    expect(passKeyForExtractionConfig({ mode: "fps", sampleFps: 1.5 })).toBe(
      "fps_1.5",
    );
    expect(
      passKeyForExtractionConfig({
        mode: "scene",
        sceneThreshold: 0.25,
        sampleFps: 1,
      }),
    ).toBe("scene_0.25");
  });
});

describe("resolveAdminReprocessExtraction", () => {
  it("lets advanced extraction win over adjustment", () => {
    const result = resolveAdminReprocessExtraction({
      current: { mode: "fps", sampleFps: 3 },
      adjustment: "decrease",
      extraction: { mode: "fps", sampleFps: 6 },
    });
    expect(result).toEqual({
      config: { mode: "fps", sampleFps: 6 },
      changed: true,
      source: "advanced",
    });
  });

  it("defaults to keep when body is empty", () => {
    const result = resolveAdminReprocessExtraction({
      current: { mode: "fps", sampleFps: 3 },
    });
    expect(result.changed).toBe(false);
    expect(result.source).toBe("keep");
  });
});

describe("normalizeExtractionConfig / helpers", () => {
  it("normalizes and compares", () => {
    expect(normalizeExtractionConfig({ mode: "fps", sampleFps: 3 })).toEqual({
      mode: "fps",
      sampleFps: 3,
    });
    expect(normalizeExtractionConfig({ mode: "roster-ocr" })).toBeNull();
    expect(
      extractionConfigsEqual(
        { mode: "fps", sampleFps: 3 },
        { mode: "fps", sampleFps: 3 },
      ),
    ).toBe(true);
    expect(summarizeExtractionConfig({ mode: "fps", sampleFps: 3 })).toBe(
      "3 frames per second",
    );
    expect(canIncreaseFps(3)).toBe(true);
    expect(canDecreaseFps(1)).toBe(false);
    expect(adHocReprocessCampaignName("bank-deposit-slip-history")).toBe(
      "Ad-hoc reprocess · bank-deposit-slip-history",
    );
  });
});
