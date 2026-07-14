/**
 * Pre-process Power Details screenshots for Tesseract.
 *
 * The modal mixes a white-on-dark "Hero Power" total with light-bg component
 * rows. A single aggressive normalize/sharpen pass often erases the header and
 * weak rows (Hero Tier). We expose two crops:
 * - body: soft greyscale upscale of the card
 * - header: top band, inverted so white text becomes dark-on-light
 */

import type { RosterOcrConfig } from "@/lib/members/roster-ocr/types";

export type PowerDetailsPreprocessResult = {
  buffer: Buffer;
  width: number;
  height: number;
};

/** Digits + label letters; keep common OCR junk that parse strips later. */
const POWER_DETAILS_CHAR_WHITELIST =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789" +
  "&.,:'`´’′/-_[](){}%!?#@+¥$€°\" ";

export const POWER_DETAILS_BODY_OCR_CONFIG: Partial<RosterOcrConfig> = {
  mode: "roster-ocr",
  preprocessScale: 2.75,
  // Single column of label/value rows.
  tesseractPsm: 4,
  charWhitelist: POWER_DETAILS_CHAR_WHITELIST,
  // Keep weak rows (Hero Tier is often low-confidence).
  minWordConfidence: 0,
};

export const POWER_DETAILS_HEADER_OCR_CONFIG: Partial<RosterOcrConfig> = {
  mode: "roster-ocr",
  preprocessScale: 3,
  // Sparse / single-line style for the inverted Hero Power band.
  tesseractPsm: 6,
  charWhitelist: POWER_DETAILS_CHAR_WHITELIST,
  minWordConfidence: 0,
};

/** @deprecated Prefer BODY/HEADER configs; kept for callers that import one config. */
export const POWER_DETAILS_OCR_CONFIG = POWER_DETAILS_BODY_OCR_CONFIG;

function modalCropBox(srcWidth: number, srcHeight: number) {
  // Phone screenshots: Power Details card is centered; top banner + side HUD add noise.
  const cropLeft = Math.round(srcWidth * 0.06);
  const cropTop = Math.round(srcHeight * 0.04);
  const cropWidth = Math.round(srcWidth * 0.88);
  const cropHeight = Math.round(srcHeight * 0.62);
  return {
    left: Math.max(0, cropLeft),
    top: Math.max(0, cropTop),
    width: Math.min(cropWidth, srcWidth - cropLeft),
    height: Math.min(cropHeight, srcHeight - cropTop),
  };
}

export async function preprocessPowerDetailsImage(
  input: Buffer,
  scale = POWER_DETAILS_BODY_OCR_CONFIG.preprocessScale ?? 2.75,
): Promise<PowerDetailsPreprocessResult> {
  const sharp = (await import("sharp")).default;

  const image = sharp(input);
  const meta = await image.metadata();
  const srcWidth = meta.width ?? 1080;
  const srcHeight = meta.height ?? 1920;
  const crop = modalCropBox(srcWidth, srcHeight);

  const targetWidth = Math.round(crop.width * scale);
  const targetHeight = Math.round(crop.height * scale);

  // Soft body pass — avoid heavy normalize so mid-grey rows survive.
  const buffer = await image
    .extract(crop)
    .resize(targetWidth, targetHeight, { kernel: sharp.kernel.lanczos3 })
    .greyscale()
    .normalize({ lower: 1, upper: 99 })
    .linear(1.15, -12)
    .sharpen({ sigma: 0.5 })
    .png()
    .toBuffer();

  return { buffer, width: targetWidth, height: targetHeight };
}

/**
 * Crop the top of the Power Details modal and invert so the white-on-dark
 * Hero Power total becomes dark text on a light field for Tesseract.
 */
export async function preprocessPowerDetailsHeaderBand(
  input: Buffer,
  scale = POWER_DETAILS_HEADER_OCR_CONFIG.preprocessScale ?? 3,
): Promise<PowerDetailsPreprocessResult> {
  const sharp = (await import("sharp")).default;

  const image = sharp(input);
  const meta = await image.metadata();
  const srcWidth = meta.width ?? 1080;
  const srcHeight = meta.height ?? 1920;
  const modal = modalCropBox(srcWidth, srcHeight);

  // Header total sits in the upper ~22% of the modal card.
  const headerHeight = Math.max(48, Math.round(modal.height * 0.22));
  const crop = {
    left: modal.left,
    top: modal.top,
    width: modal.width,
    height: Math.min(headerHeight, modal.height),
  };

  const targetWidth = Math.round(crop.width * scale);
  const targetHeight = Math.round(crop.height * scale);

  const buffer = await image
    .extract(crop)
    .resize(targetWidth, targetHeight, { kernel: sharp.kernel.lanczos3 })
    .greyscale()
    .negate()
    .normalize({ lower: 2, upper: 98 })
    .sharpen({ sigma: 0.6 })
    .png()
    .toBuffer();

  return { buffer, width: targetWidth, height: targetHeight };
}
