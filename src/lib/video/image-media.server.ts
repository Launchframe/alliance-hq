import "server-only";

import sharp from "sharp";

/** Event-evidence image constraints (plan §6 media lifecycle). */
export const EVENT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const EVENT_IMAGE_MAX_PIXELS = 30_000_000;

export type ImageMediaKind = "png" | "jpeg";

/** Magic-byte sniffing — extension/contentType are never trusted. */
export function detectImageMediaKind(
  buffer: Buffer | Uint8Array,
): ImageMediaKind | null {
  if (buffer.length >= 8) {
    const png =
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a;
    if (png) return "png";
  }
  if (buffer.length >= 3) {
    const jpeg =
      buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    if (jpeg) return "jpeg";
  }
  return null;
}

export class ImageMediaError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ImageMediaError";
  }
}

/** Size + magic validation before any decode work. */
export function validateEventImageBytes(buffer: Buffer): ImageMediaKind {
  if (buffer.length === 0) throw new ImageMediaError("empty_image");
  if (buffer.length > EVENT_IMAGE_MAX_BYTES) {
    throw new ImageMediaError("image_too_large");
  }
  const kind = detectImageMediaKind(buffer);
  if (!kind) throw new ImageMediaError("unsupported_image_format");
  return kind;
}

/**
 * Decode + normalize one uploaded image into the canonical frame bytes:
 * EXIF orientation applied (`rotate()`), dimensions bounded, PNG output so
 * downstream OCR sees one consistent format.
 */
export async function normalizeEventImage(
  buffer: Buffer,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  validateEventImageBytes(buffer);
  const metadata = await sharp(buffer, { failOn: "truncated" }).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width <= 0 || height <= 0) {
    throw new ImageMediaError("unsupported_image_format");
  }
  if (width * height > EVENT_IMAGE_MAX_PIXELS) {
    throw new ImageMediaError("image_too_many_pixels");
  }
  const { data: normalized, info } = await sharp(buffer, {
    failOn: "truncated",
  })
    .rotate()
    .png()
    .toBuffer({ resolveWithObject: true });
  // Report the post-orientation pixel size — metadata() above is pre-rotate.
  return { buffer: normalized, width: info.width, height: info.height };
}

/** Declared-filename check for the init path (before bytes exist). */
export function looksLikeImageUpload(
  fileName: string,
  contentType: string | null | undefined,
): boolean {
  const type = contentType?.toLowerCase() ?? "";
  if (type === "image/png" || type === "image/jpeg" || type === "image/jpg") {
    return true;
  }
  return /\.(png|jpe?g)$/i.test(fileName);
}
