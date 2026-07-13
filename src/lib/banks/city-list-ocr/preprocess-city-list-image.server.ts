import "server-only";

/**
 * City List Bank Stronghold screenshot pre-processing.
 *
 * Tile text (gold values, green coordinates) sits on dark cards. Plain roster
 * greyscale often loses that contrast; normalize + sharpen after upscale keeps
 * enough signal for Tesseract while still reducing chroma noise.
 */

export type CityListPreprocessResult = {
  buffer: Buffer;
  width: number;
  height: number;
};

export const CITY_LIST_PREPROCESS_SCALE = 2.5;

export async function preprocessCityListImage(
  input: Buffer,
  options?: { scale?: number },
): Promise<CityListPreprocessResult> {
  const sharp = (await import("sharp")).default;
  const scale = options?.scale ?? CITY_LIST_PREPROCESS_SCALE;

  const image = sharp(input);
  const meta = await image.metadata();
  const srcWidth = meta.width ?? 1080;
  const srcHeight = meta.height ?? 1920;

  const targetWidth = Math.round(srcWidth * scale);
  const targetHeight = Math.round(srcHeight * scale);

  const buffer = await image
    .resize(targetWidth, targetHeight, { kernel: sharp.kernel.lanczos3 })
    .greyscale()
    .normalize()
    .sharpen({ sigma: 1 })
    .png()
    .toBuffer();

  return { buffer, width: targetWidth, height: targetHeight };
}
