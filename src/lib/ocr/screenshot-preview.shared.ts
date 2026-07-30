import type { CropRect } from "@/lib/ocr/game-modal-detect.shared";

export const SCREENSHOT_PREVIEW_MAX_EDGE = 1200;
export const SCREENSHOT_PREVIEW_WEBP_QUALITY = 80;

export async function downscaleScreenshotPreview(
  buffer: Buffer,
  maxEdge = SCREENSHOT_PREVIEW_MAX_EDGE,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(buffer).metadata();
  const srcWidth = meta.width ?? 1;
  const srcHeight = meta.height ?? 1;
  const scale =
    Math.max(srcWidth, srcHeight) > maxEdge
      ? maxEdge / Math.max(srcWidth, srcHeight)
      : 1;
  const width = Math.max(1, Math.round(srcWidth * scale));
  const height = Math.max(1, Math.round(srcHeight * scale));
  const out = await sharp(buffer)
    .resize(width, height, { kernel: sharp.kernel.lanczos3 })
    .webp({ quality: SCREENSHOT_PREVIEW_WEBP_QUALITY })
    .toBuffer();
  return { buffer: out, width, height };
}

export async function extractModalPreview(
  source: Buffer,
  modal: CropRect,
): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const extracted = await sharp(source)
    .extract({
      left: modal.left,
      top: modal.top,
      width: modal.width,
      height: modal.height,
    })
    .toBuffer();
  const { buffer } = await downscaleScreenshotPreview(extracted);
  return buffer;
}

export async function extractBandPreview(
  source: Buffer,
  crop: CropRect,
): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const extracted = await sharp(source)
    .extract({
      left: crop.left,
      top: crop.top,
      width: crop.width,
      height: crop.height,
    })
    .toBuffer();
  const { buffer } = await downscaleScreenshotPreview(extracted);
  return buffer;
}
