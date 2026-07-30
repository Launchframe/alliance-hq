import { describe, expect, it } from "vitest";
import sharp from "sharp";

import {
  detectGameModalRect,
  modalRectFromPreset,
} from "@/lib/ocr/game-modal-detect.shared";

async function syntheticModalScreenshot(): Promise<Buffer> {
  const width = 1080;
  const height = 1920;
  const modalLeft = Math.round(width * 0.18);
  const modalTop = Math.round(height * 0.08);
  const modalWidth = Math.round(width * 0.64);
  const modalHeight = Math.round(height * 0.72);

  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 3;
      const inModal =
        x >= modalLeft &&
        x < modalLeft + modalWidth &&
        y >= modalTop &&
        y < modalTop + modalHeight;
      if (inModal) {
        pixels[idx] = 198;
        pixels[idx + 1] = 198;
        pixels[idx + 2] = 198;
      } else {
        pixels[idx] = 40 + ((x * 7 + y * 13) % 180);
        pixels[idx + 1] = 20 + ((x * 11 + y * 5) % 160);
        pixels[idx + 2] = 60 + ((x * 3 + y * 17) % 140);
      }
    }
  }

  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

describe("detectGameModalRect", () => {
  it("finds a centered grey modal on a colorful background", async () => {
    const buffer = await syntheticModalScreenshot();
    const result = await detectGameModalRect(buffer);
    expect(result).not.toBeNull();
    expect(result!.method).toBe("grey_cc");
    expect(result!.confidence).toBeGreaterThan(0.3);

    const meta = await sharp(buffer).metadata();
    const srcWidth = meta.width ?? 1080;
    const srcHeight = meta.height ?? 1920;
    const areaFraction =
      (result!.rect.width * result!.rect.height) / (srcWidth * srcHeight);
    expect(areaFraction).toBeGreaterThan(0.2);
    expect(areaFraction).toBeLessThan(0.75);

    const centerX = result!.rect.left + result!.rect.width / 2;
    const centerY = result!.rect.top + result!.rect.height / 2;
    expect(Math.abs(centerX - srcWidth / 2)).toBeLessThan(srcWidth * 0.12);
    expect(Math.abs(centerY - srcHeight / 2)).toBeLessThan(srcHeight * 0.12);
  });

  it("modalRectFromPreset maps fractional crop to pixel rect", () => {
    const result = modalRectFromPreset(1000, 2000, {
      left: 0.1,
      top: 0.2,
      width: 0.5,
      height: 0.4,
    });
    expect(result.rect).toEqual({
      left: 100,
      top: 400,
      width: 500,
      height: 800,
    });
    expect(result.method).toBe("fallback_preset");
  });
});
