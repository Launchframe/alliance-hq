import "server-only";

/**
 * City List Bank Stronghold screenshot pre-processing.
 *
 * Tile text mixes gold amounts, white Lv labels, and lime-green coordinates on
 * peach cards (plus a large "Bank Stronghold" watermark). A single aggressive
 * greyscale+normalize pass often keeps bottom-row coords but drops the top row
 * and crushes `Lv:` / amount tokens. We expose two soft passes and OCR both:
 * - primary: soft greyscale (amounts, levels, deposits, many coords)
 * - green: green-channel emphasis (recovers lime coordinate lines the primary
 *   pass misses)
 */

export type CityListPreprocessResult = {
  buffer: Buffer;
  width: number;
  height: number;
};

/** Softer than the original 2.5+hard normalize; THP-style midtone preservation. */
export const CITY_LIST_PREPROCESS_SCALE = 2.75;

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
    .normalize({ lower: 2, upper: 98 })
    .sharpen({ sigma: 0.6 })
    .png()
    .toBuffer();

  return { buffer, width: targetWidth, height: targetHeight };
}

/**
 * Green-channel pass for lime `#server [X:…, Y:…]` labels that greyscale
 * often loses against peach card backgrounds / watermarks.
 */
export async function preprocessCityListGreenChannel(
  input: Buffer,
  options?: { scale?: number },
): Promise<CityListPreprocessResult> {
  const sharp = (await import("sharp")).default;
  const scale = options?.scale ?? 3;

  const image = sharp(input);
  const meta = await image.metadata();
  const srcWidth = meta.width ?? 1080;
  const srcHeight = meta.height ?? 1920;

  const targetWidth = Math.round(srcWidth * scale);
  const targetHeight = Math.round(srcHeight * scale);

  const { data, info } = await image
    .resize(targetWidth, targetHeight, { kernel: sharp.kernel.lanczos3 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out = Buffer.alloc(info.width * info.height);
  for (let i = 0, p = 0; i < data.length; i += info.channels, p += 1) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    // Keep luma, darken lime (G ≫ R) without blooming coords into black bars.
    const luma = 0.25 * r + 0.5 * g + 0.25 * b;
    const greenness = Math.max(0, g - Math.max(r, b));
    out[p] = Math.max(0, Math.min(255, Math.round(luma - greenness * 1.15)));
  }

  const buffer = await sharp(out, {
    raw: { width: info.width, height: info.height, channels: 1 },
  })
    .normalize({ lower: 2, upper: 98 })
    .sharpen({ sigma: 0.7 })
    .png()
    .toBuffer();

  return { buffer, width: targetWidth, height: targetHeight };
}
