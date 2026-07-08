/**
 * Image pre-processing for roster OCR using sharp.
 *
 * Converts the input image to greyscale and optionally up-scales it so that
 * small text (member names, power values) is easier for Tesseract to read.
 */

import sharp from "sharp";

import type { RosterOcrConfig } from "@/lib/members/roster-ocr/types";
import { DEFAULT_ROSTER_OCR_CONFIG } from "@/lib/members/roster-ocr/types";

export type PreprocessResult = {
  /** PNG buffer ready to hand to Tesseract. */
  buffer: Buffer;
  width: number;
  height: number;
};

/**
 * Pre-process a roster screenshot for Tesseract OCR.
 *
 * Steps:
 *  1. Decode any image format supported by sharp (PNG, JPEG, WebP, …).
 *  2. Up-scale by `config.preprocessScale` (default 2×) to enlarge small text.
 *  3. Convert to greyscale — reduces noise and improves OCR confidence.
 *  4. Output as lossless PNG.
 */
export async function preprocessRosterImage(
  input: Buffer,
  config: Partial<RosterOcrConfig> = {},
): Promise<PreprocessResult> {
  const scale = config.preprocessScale ?? DEFAULT_ROSTER_OCR_CONFIG.preprocessScale ?? 2.0;

  const image = sharp(input);
  const meta = await image.metadata();
  const srcWidth = meta.width ?? 1080;
  const srcHeight = meta.height ?? 1920;

  const targetWidth = Math.round(srcWidth * scale);
  const targetHeight = Math.round(srcHeight * scale);

  const buffer = await image
    .resize(targetWidth, targetHeight, { kernel: sharp.kernel.lanczos3 })
    .greyscale()
    .png()
    .toBuffer();

  return { buffer, width: targetWidth, height: targetHeight };
}
