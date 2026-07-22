import { describe, expect, it } from "vitest";

import { scrubSmallInkComponents } from "@/lib/thp/hero-power-ocr/scrub-value-ink.shared";

describe("scrubSmallInkComponents", () => {
  it("removes a small dark blob while keeping a larger digit-like block", () => {
    const width = 20;
    const height = 20;
    const pixels = Buffer.alloc(width * height, 255);
    // Large ink block (digit-like)
    for (let y = 4; y < 16; y += 1) {
      for (let x = 4; x < 12; x += 1) {
        pixels[y * width + x] = 20;
      }
    }
    // Tiny comma-like blob
    pixels[17 * width + 14] = 20;
    pixels[17 * width + 15] = 20;
    pixels[18 * width + 14] = 20;

    const out = scrubSmallInkComponents(pixels, width, height);
    expect(out[17 * width + 14]).toBe(255);
    expect(out[8 * width + 8]).toBe(20);
  });
});
