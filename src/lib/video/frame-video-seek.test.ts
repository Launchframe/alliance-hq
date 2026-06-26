import { describe, expect, it } from "vitest";

import {
  previewSeekSecondsForFrame,
  previewWheelSeekSeconds,
} from "./frame-video-seek";

describe("previewSeekSecondsForFrame", () => {
  it("seeks to the exact frame timestamp", () => {
    expect(previewSeekSecondsForFrame(2, { "2": 10.5 })).toBe(10.5);
  });

  it("clamps negative timestamps at zero", () => {
    expect(previewSeekSecondsForFrame(0, { "0": -0.4 })).toBe(0);
  });

  it("returns null when frame index or timestamp is missing", () => {
    expect(previewSeekSecondsForFrame(null, { "0": 1 })).toBeNull();
    expect(previewSeekSecondsForFrame(1, {})).toBeNull();
  });
});

describe("previewWheelSeekSeconds", () => {
  it("seeks forward on scroll down (positive deltaY)", () => {
    expect(previewWheelSeekSeconds(10, 100, 60)).toBe(11);
  });

  it("seeks backward on scroll up (negative deltaY)", () => {
    expect(previewWheelSeekSeconds(10, -100, 60)).toBe(9);
  });

  it("clamps at zero and duration", () => {
    expect(previewWheelSeekSeconds(0.2, -100, 60)).toBe(0);
    expect(previewWheelSeekSeconds(59.5, 100, 60)).toBe(60);
  });

  it("is a no-op when deltaY is zero", () => {
    expect(previewWheelSeekSeconds(10, 0, 60)).toBe(10);
  });

  it("is a no-op when current time is not finite", () => {
    expect(previewWheelSeekSeconds(Number.NaN, 100, 60)).toBeNaN();
  });

  it("allows forward seek before duration metadata is known", () => {
    expect(previewWheelSeekSeconds(10, 100, Number.NaN)).toBe(11);
    expect(previewWheelSeekSeconds(10, 100, undefined)).toBe(11);
  });
});
