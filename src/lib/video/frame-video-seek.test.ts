import { describe, expect, it } from "vitest";

import { previewSeekSecondsForFrame } from "./frame-video-seek";

describe("previewSeekSecondsForFrame", () => {
  it("seeks one second before the frame timestamp", () => {
    expect(previewSeekSecondsForFrame(2, { "2": 10.5 })).toBe(9.5);
  });

  it("clamps at zero", () => {
    expect(previewSeekSecondsForFrame(0, { "0": 0.4 })).toBe(0);
  });

  it("returns null when frame index or timestamp is missing", () => {
    expect(previewSeekSecondsForFrame(null, { "0": 1 })).toBeNull();
    expect(previewSeekSecondsForFrame(1, {})).toBeNull();
  });
});
