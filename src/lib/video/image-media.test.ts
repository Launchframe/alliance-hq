import { describe, expect, it } from "vitest";
import sharp from "sharp";

import {
  detectImageMediaKind,
  EVENT_IMAGE_MAX_BYTES,
  ImageMediaError,
  looksLikeImageUpload,
  normalizeEventImage,
  validateEventImageBytes,
} from "@/lib/video/image-media.server";

async function makePng(width = 120, height = 80): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 20, g: 40, b: 60 },
    },
  })
    .png()
    .toBuffer();
}

describe("detectImageMediaKind", () => {
  it("detects PNG and JPEG magic bytes", async () => {
    expect(detectImageMediaKind(await makePng())).toBe("png");
    const jpeg = await sharp(await makePng()).jpeg().toBuffer();
    expect(detectImageMediaKind(jpeg)).toBe("jpeg");
  });

  it("rejects non-image bytes", () => {
    expect(detectImageMediaKind(Buffer.from("MZ executable"))).toBeNull();
    expect(detectImageMediaKind(Buffer.alloc(0))).toBeNull();
  });
});

describe("validateEventImageBytes", () => {
  it("rejects empty, oversized, and non-image payloads", async () => {
    expect(() => validateEventImageBytes(Buffer.alloc(0))).toThrow(
      ImageMediaError,
    );
    expect(() =>
      validateEventImageBytes(Buffer.alloc(EVENT_IMAGE_MAX_BYTES + 1, 0x89)),
    ).toThrowError(expect.objectContaining({ code: "image_too_large" }));
    expect(() =>
      validateEventImageBytes(Buffer.from("not an image at all")),
    ).toThrowError(
      expect.objectContaining({ code: "unsupported_image_format" }),
    );
    expect(validateEventImageBytes(await makePng())).toBe("png");
  });
});

describe("normalizeEventImage", () => {
  it("applies EXIF orientation and emits PNG", async () => {
    // 100x200 stored pixels rotated 90° by EXIF → 200x100 normalized.
    const jpeg = await sharp({
      create: {
        width: 100,
        height: 200,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const normalized = await normalizeEventImage(jpeg);
    expect(normalized.width).toBe(200);
    expect(normalized.height).toBe(100);
    expect(detectImageMediaKind(normalized.buffer)).toBe("png");
  });

  it("rejects images over the megapixel cap", async () => {
    const wide = await sharp({
      create: {
        width: 6100,
        height: 5000,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer();
    await expect(normalizeEventImage(wide)).rejects.toMatchObject({
      code: "image_too_many_pixels",
    });
  });
});

describe("looksLikeImageUpload", () => {
  it("accepts png/jpeg content types and extensions", () => {
    expect(looksLikeImageUpload("shot.png", null)).toBe(true);
    expect(looksLikeImageUpload("shot.jpeg", "image/jpeg")).toBe(true);
    expect(looksLikeImageUpload("clip.mp4", "video/mp4")).toBe(false);
    expect(looksLikeImageUpload("shot.png.exe", "image/png")).toBe(true);
  });
});
