import "server-only";

import { runTesseract } from "@/lib/members/roster-ocr/tesseract";
import {
  inGameScreenshotLayoutFromTopRow,
  inGameTopStripBox,
  type InGameScreenshotLayout,
} from "@/lib/ocr/in-game-crop.shared";

const TOP_ROW_WHITELIST = "0123456789.,KMGkmg ";

/**
 * Read the top row and decide whether the resource HUD is still in frame.
 *
 * Light HUD text sits on a dark bar, so the strip is inverted before OCR.
 * A detector failure keeps the phone layout: that is the geometry the
 * existing menus were tuned for.
 */
export async function readInGameScreenshotLayout(
  image: Buffer,
): Promise<InGameScreenshotLayout> {
  try {
    const text = await readInGameTopRowText(image);
    return inGameScreenshotLayoutFromTopRow(text);
  } catch {
    return "phone";
  }
}

export async function readInGameTopRowText(image: Buffer): Promise<string> {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(image).metadata();
  const width = meta.width ?? 1;
  const height = meta.height ?? 1;
  const strip = inGameTopStripBox(width, height);
  const buffer = await sharp(image)
    .extract(strip)
    .resize({ width: Math.max(1, Math.round(width * 2)) })
    .greyscale()
    .negate()
    .normalize()
    .png()
    .toBuffer();
  const lines = await runTesseract(buffer, {
    tesseractPsm: 6,
    charWhitelist: TOP_ROW_WHITELIST,
    minWordConfidence: 0,
  });
  return lines.map((line) => line.text).join(" ");
}
