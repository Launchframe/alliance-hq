import "server-only";

import sharp from "sharp";

import { runTesseract } from "@/lib/members/roster-ocr/tesseract";
import { textShowsLeaderboardMenu } from "@/lib/video/opening-menu-probe.shared";

/** Top band that holds the Daily Rank tab and Ranking / Commander / Points headers. */
const MENU_TITLE_CROP_FRACTION = 0.22;

export async function bufferShowsLeaderboardMenu(
  image: Buffer,
): Promise<boolean> {
  const source = sharp(image);
  const meta = await source.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width < 8 || height < 8) return false;
  const cropHeight = Math.max(8, Math.min(height, Math.round(height * MENU_TITLE_CROP_FRACTION)));
  const png = await source
    .extract({ left: 0, top: 0, width, height: cropHeight })
    .grayscale()
    .normalize()
    .png()
    .toBuffer();
  const lines = await runTesseract(png, {
    tesseractPsm: 6,
    minWordConfidence: 0,
  });
  return textShowsLeaderboardMenu(lines.map((line) => line.text).join("\n"));
}
