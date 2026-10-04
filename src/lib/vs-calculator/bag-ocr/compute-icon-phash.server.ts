import "server-only";

import sharp from "sharp";

/** 64-bit dHash as 16 hex chars (deterministic for the same icon crop). */
export async function computeIconPhashFromBuffer(
  buffer: Buffer,
): Promise<string> {
  const { data } = await sharp(buffer)
    .resize(9, 8, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let bits = "";
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = data[y * 9 + x] ?? 0;
      const right = data[y * 9 + x + 1] ?? 0;
      bits += left < right ? "1" : "0";
    }
  }

  let hex = "";
  for (let i = 0; i < 64; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

export async function extractImageRegion(
  imageBuffer: Buffer,
  region: { left: number; top: number; width: number; height: number },
): Promise<Buffer> {
  return sharp(imageBuffer)
    .extract({
      left: Math.max(0, Math.floor(region.left)),
      top: Math.max(0, Math.floor(region.top)),
      width: Math.max(1, Math.floor(region.width)),
      height: Math.max(1, Math.floor(region.height)),
    })
    .png()
    .toBuffer();
}

export async function readImageDimensions(
  buffer: Buffer,
): Promise<{ width: number; height: number }> {
  const meta = await sharp(buffer).metadata();
  return {
    width: meta.width ?? 0,
    height: meta.height ?? 0,
  };
}
