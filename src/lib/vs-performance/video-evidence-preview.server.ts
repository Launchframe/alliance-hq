import "server-only";

import { Readable } from "node:stream";
import sharp from "sharp";

import { MAX_SCREENSHOT_UPLOAD_BYTES } from "@/lib/ocr/screenshot-upload.shared";
import type { VsCaptureKind } from "./vs-capture.shared";
import { VsPerformanceError } from "./weekly-plan.shared";

export const VS_VIDEO_PREVIEW_RECT = {
  daily_totals: { left: .02, top: .23, width: .96, height: .30 },
  weekly_overview: { left: .02, top: .13, width: .96, height: .47 },
} as const;

export async function renderVsVideoEvidencePreview(stream: ReadableStream<Uint8Array>, kind: VsCaptureKind): Promise<Buffer> {
  const region = VS_VIDEO_PREVIEW_RECT[kind];
  if (!region) throw new VsPerformanceError("capture_invalid", 400);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of Readable.fromWeb(stream as import("node:stream/web").ReadableStream)) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_SCREENSHOT_UPLOAD_BYTES) throw new VsPerformanceError("capture_invalid", 400);
    chunks.push(bytes);
  }
  const rotated = await sharp(Buffer.concat(chunks), { limitInputPixels: 40_000_000 }).rotate().png().toBuffer({ resolveWithObject: true });
  const left = Math.floor(rotated.info.width * region.left);
  const top = Math.floor(rotated.info.height * region.top);
  const width = Math.min(rotated.info.width - left, Math.floor(rotated.info.width * region.width));
  const height = Math.min(rotated.info.height - top, Math.floor(rotated.info.height * region.height));
  if (width < 1 || height < 1) throw new VsPerformanceError("capture_invalid", 400);
  return sharp(rotated.data).extract({ left, top, width, height }).resize({ width: 1200, withoutEnlargement: true }).png().toBuffer();
}
