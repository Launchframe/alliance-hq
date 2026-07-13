import { describe, expect, it } from "vitest";

import { isPortraitVideo } from "./survey-preview.shared";

describe("isPortraitVideo", () => {
  it("detects portrait when height exceeds width", () => {
    expect(isPortraitVideo(1080, 1920)).toBe(true);
  });

  it("treats landscape and square as non-portrait", () => {
    expect(isPortraitVideo(1920, 1080)).toBe(false);
    expect(isPortraitVideo(1080, 1080)).toBe(false);
  });

  it("returns false when dimensions are missing", () => {
    expect(isPortraitVideo(0, 1920)).toBe(false);
    expect(isPortraitVideo(1080, 0)).toBe(false);
  });
});
