/**
 * Pre-process Power Details screenshots for Tesseract.
 *
 * Crops toward the centered modal (drops alliance broadcast banners / side HUD),
 * upscales, and applies mild contrast — heavy normalize/sharpen was washing out
 * the white-on-dark "Hero Power" header and yielding zero OCR lines.
 */

import type { RosterOcrConfig } from "@/lib/members/roster-ocr/types";

export type PowerDetailsPreprocessResult = {
  buffer: Buffer;
  width: number;
  height: number;
};

export const POWER_DETAILS_OCR_CONFIG: Partial<RosterOcrConfig> = {
  mode: "roster-ocr",
  preprocessScale: 2.5,
  tesseractPsm: 6,
  charWhitelist:
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789&.,:'`/-[]()%! ",
  minWordConfidence: 25,
};

export async function preprocessPowerDetailsImage(
  input: Buffer,
  scale = POWER_DETAILS_OCR_CONFIG.preprocessScale ?? 2.5,
): Promise<PowerDetailsPreprocessResult> {
  const sharp = (await import("sharp")).default;

  const image = sharp(input);
  const meta = await image.metadata();
  const srcWidth = meta.width ?? 1080;
  const srcHeight = meta.height ?? 1920;

  // Phone screenshots: Power Details card is centered; top banner + side HUD add noise.
  const cropLeft = Math.round(srcWidth * 0.06);
  const cropTop = Math.round(srcHeight * 0.04);
  const cropWidth = Math.round(srcWidth * 0.88);
  const cropHeight = Math.round(srcHeight * 0.62);

  const targetWidth = Math.round(cropWidth * scale);
  const targetHeight = Math.round(cropHeight * scale);

  const buffer = await image
    .extract({
      left: Math.max(0, cropLeft),
      top: Math.max(0, cropTop),
      width: Math.min(cropWidth, srcWidth - cropLeft),
      height: Math.min(cropHeight, srcHeight - cropTop),
    })
    .resize(targetWidth, targetHeight, { kernel: sharp.kernel.lanczos3 })
    .greyscale()
    .normalize({ lower: 5, upper: 95 })
    .sharpen({ sigma: 0.8 })
    .png()
    .toBuffer();

  return { buffer, width: targetWidth, height: targetHeight };
}
