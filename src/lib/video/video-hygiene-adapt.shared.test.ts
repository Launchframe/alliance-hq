import { describe, expect, it } from "vitest";

import { DEFAULT_PRIMARY_PASS, SHADOW_PASS_AB } from "./pass-definitions";
import {
  applyDenseAdaptOverlay,
  shouldApplyDenseAdaptBias,
} from "./video-hygiene-adapt.shared";

describe("shouldApplyDenseAdaptBias", () => {
  const base = {
    jobCount: 5,
    thumbsUpRate: 0.8,
    avgQualityScore: 0.8,
    scrollStyleCounts: { slow_steady: 4 },
    previouslyOn: false,
  };

  it("stays off when history is healthy", () => {
    expect(shouldApplyDenseAdaptBias(base)).toBe(false);
  });

  it("turns on for poor thumbs", () => {
    expect(
      shouldApplyDenseAdaptBias({ ...base, thumbsUpRate: 0.3 }),
    ).toBe(true);
  });

  it("turns on for chaotic scroll", () => {
    expect(
      shouldApplyDenseAdaptBias({
        ...base,
        scrollStyleCounts: { chaotic: 3 },
      }),
    ).toBe(true);
  });

  it("keeps previous state when job count is thin", () => {
    expect(
      shouldApplyDenseAdaptBias({
        ...base,
        jobCount: 1,
        previouslyOn: true,
        thumbsUpRate: 0.9,
      }),
    ).toBe(true);
    expect(
      shouldApplyDenseAdaptBias({
        ...base,
        jobCount: 1,
        previouslyOn: false,
        thumbsUpRate: 0.1,
      }),
    ).toBe(false);
  });

  it("uses hysteresis — stays on until recovered", () => {
    expect(
      shouldApplyDenseAdaptBias({
        ...base,
        previouslyOn: true,
        thumbsUpRate: 0.55,
        avgQualityScore: 0.55,
      }),
    ).toBe(true);
    expect(
      shouldApplyDenseAdaptBias({
        ...base,
        previouslyOn: true,
        thumbsUpRate: 0.75,
        avgQualityScore: 0.7,
        scrollStyleCounts: { slow_steady: 3 },
      }),
    ).toBe(false);
  });
});

describe("applyDenseAdaptOverlay", () => {
  it("densifies default primary one ladder step", () => {
    const result = applyDenseAdaptOverlay(DEFAULT_PRIMARY_PASS);
    expect(result.changed).toBe(true);
    expect(result.config.mode).toBe("fps");
    expect(result.passKey).toMatch(/^fps_/);
  });

  it("does not change when already at densest ladder notch", () => {
    const max: typeof SHADOW_PASS_AB = { mode: "fps", sampleFps: 6 };
    const result = applyDenseAdaptOverlay(max);
    expect(result.changed).toBe(false);
    expect(result.passKey).toBe("fps_6");
  });
});
