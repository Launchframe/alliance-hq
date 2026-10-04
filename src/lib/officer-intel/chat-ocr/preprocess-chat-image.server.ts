import "server-only";

import sharp from "sharp";

/** Greyscale preprocess for dark in-game chat screenshots. */
export async function preprocessOfficerChatImage(
  imageBuffer: Buffer,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const pipeline = sharp(imageBuffer).rotate().greyscale().normalize();
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  return {
    buffer: data,
    width: info.width,
    height: info.height,
  };
}
