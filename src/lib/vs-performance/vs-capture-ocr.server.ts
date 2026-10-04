import "server-only";

import sharp from "sharp";

import { runTesseract } from "@/lib/members/roster-ocr/tesseract";
import { MAX_SCREENSHOT_UPLOAD_BYTES } from "@/lib/ocr/screenshot-upload.shared";
import { VsPerformanceError } from "./weekly-plan.shared";
import { parseVsCaptureLines, type VsCaptureCandidate, type VsCaptureFieldText, type VsCaptureKind, type VsCaptureOcrLine } from "./vs-capture.shared";
import type { VsVideoRequestedKind } from "./video-evidence.shared";

export const VS_CAPTURE_OCR_LAYOUT = {
  processedWidth: 1800,
  maxPixels: 40_000_000,
  baseLeft: .02,
  baseWidth: .96,
  weekTop: .13,
  weekHeight: .47,
  dayTop: .23,
  dayHeight: .20,
  weekScoreYFromHeader: .165,
  weekScoreHeight: .12,
  weekLeftX: .34,
  weekRightX: .55,
  weekScoreWidth: .12,
  dayTagYFromDay: .04,
  dayScoreYFromDay: .10,
  dayTagHeight: .06,
  dayScoreHeight: .065,
  dayLeftTagX: .12,
  dayLeftTagWidth: .22,
  dayRightTagX: .66,
  dayRightTagWidth: .25,
  dayLeftScoreX: .12,
  dayRightScoreX: .57,
  dayRightScoreWidth: .38,
  dayRightScoreHeight: .05,
  dayScoreWidth: .31,
  lightMinChannel: 180,
  lightMaxSpread: 65,
  darkMaxChannel: 80,
  fallbackThreshold: 110,
  fieldScale: 4,
  fieldPadding: 24,
} as const;

export function findVsCaptureTitle(kind: VsCaptureKind, lines: readonly VsCaptureOcrLine[], imageWidth: number): VsCaptureOcrLine | undefined {
  const pattern = kind === "weekly_overview"
    ? /weekly\s+schedule|programa[cç][aã]o\s+semanal|cronograma\s+semanal/i
    : /duel[^a-z]*themes|temas[^a-z]*d[oe][^a-z]*duelo/i;
  const complete = lines.find(line => line.bbox && pattern.test(line.text));
  if (complete || kind !== "daily_totals") return complete;
  for (const first of lines) {
    if (!first.bbox || !/^\s*duel\s*$/i.test(first.text)) continue;
    for (const second of lines) {
      if (!second.bbox || !/^\s*themes\s*$/i.test(second.text)) continue;
      const a = first.bbox, b = second.bbox;
      const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      const minimumHeight = Math.min(a.y1 - a.y0, b.y1 - b.y0);
      if (minimumHeight <= 0 || overlap < minimumHeight * .5 || b.x0 < a.x1 || b.x0 - a.x1 > imageWidth * .08 || a.x0 > imageWidth * .65 || b.x1 < imageWidth * .35) continue;
      return { text: "DUEL THEMES", bbox: { x0: a.x0, y0: Math.min(a.y0, b.y0), x1: b.x1, y1: Math.max(a.y1, b.y1) } };
    }
  }
  return undefined;
}

export async function parseVsCaptureImage(bytes: Buffer, kind: VsCaptureKind, requireWeeklyRows = false): Promise<VsCaptureCandidate> {
  if (!["weekly_overview", "daily_totals"].includes(kind) || bytes.length === 0 || bytes.length > MAX_SCREENSHOT_UPLOAD_BYTES) throw new VsPerformanceError("capture_invalid", 400);
  const config = VS_CAPTURE_OCR_LAYOUT;
  const metadata = await sharp(bytes, { limitInputPixels: config.maxPixels }).metadata();
  if (!metadata.width || !metadata.height || !["png", "jpeg"].includes(metadata.format ?? "")) throw new VsPerformanceError("capture_invalid", 400);
  const image = await sharp(bytes, { limitInputPixels: config.maxPixels }).rotate().flatten({ background: "white" }).png().toBuffer();
  const oriented = await sharp(image).metadata();
  const width = oriented.width!;
  const height = oriented.height!;
  const baseTop = Math.floor(height * (kind === "weekly_overview" ? config.weekTop : config.dayTop));
  const baseWidth = Math.floor(width * config.baseWidth);
  const baseHeight = Math.floor(height * (kind === "weekly_overview" ? config.weekHeight : config.dayHeight));
  const main = sharp(image).extract({ left: Math.floor(width * config.baseLeft), top: baseTop, width: baseWidth, height: baseHeight }).resize({ width: config.processedWidth });
  let lines = await runTesseract(await main.clone().grayscale().normalize().png().toBuffer(), { tesseractPsm: 11, minWordConfidence: 0 });
  let title = findVsCaptureTitle(kind, lines, config.processedWidth);
  if (!title) {
    lines = await runTesseract(await main.clone().png().toBuffer(), { tesseractPsm: 11, minWordConfidence: 0 });
    title = findVsCaptureTitle(kind, lines, config.processedWidth);
  }
  if (!title?.bbox) throw new VsPerformanceError("capture_failed", 422);
  if (kind === "weekly_overview" && requireWeeklyRows) {
    const days = new Set(lines.flatMap(line => {
      const match = /^\s*(?:Day|Dia)\s*([1-6])\s*$/i.exec(line.text);
      return match && line.bbox && line.bbox.x0 < config.processedWidth * .3 && line.bbox.y0 > title!.bbox!.y1 ? [Number(match[1])] : [];
    }));
    if (days.size < 2) throw new VsPerformanceError("capture_kind_unknown", 422);
  }
  const toOriginalY = (y: number) => baseTop + y * baseWidth / config.processedWidth;
  const fields: VsCaptureFieldText = {};

  async function readField(x: number, y: number, w: number, h: number, ink: "light" | "dark", digits: boolean, fallback: boolean, psm: 7 | 8 = 7): Promise<string[]> {
    const left = Math.floor(width * x);
    const top = Math.floor(y);
    const fieldWidth = Math.floor(width * w);
    const fieldHeight = Math.floor(width * h);
    if (left < 0 || top < 0 || fieldWidth < 1 || fieldHeight < 1 || left + fieldWidth > width || top + fieldHeight > height) return [];
    const crop = sharp(image).extract({ left, top, width: fieldWidth, height: fieldHeight });
    const raw = await crop.clone().toColourspace("srgb").removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const mask = Buffer.alloc(raw.info.width * raw.info.height);
    for (let index = 0; index < mask.length; index++) {
      const offset = index * raw.info.channels;
      const maximum = Math.max(raw.data[offset], raw.data[offset + 1], raw.data[offset + 2]);
      const minimum = Math.min(raw.data[offset], raw.data[offset + 1], raw.data[offset + 2]);
      mask[index] = (ink === "light" ? minimum >= config.lightMinChannel && maximum - minimum <= config.lightMaxSpread : maximum <= config.darkMaxChannel) ? 0 : 255;
    }
    const variants = [sharp(mask, { raw: { width: raw.info.width, height: raw.info.height, channels: 1 } })];
    if (fallback) variants.push(crop.clone().grayscale().normalize().threshold(config.fallbackThreshold));
    const text: string[] = [];
    for (const variant of variants) {
      const buffer = await variant.resize({ width: Math.max(320, fieldWidth * config.fieldScale) }).extend({ top: config.fieldPadding, bottom: config.fieldPadding, left: config.fieldPadding, right: config.fieldPadding, background: "white" }).png().toBuffer();
      const result = await runTesseract(buffer, { tesseractPsm: psm, minWordConfidence: 0, ...(digits ? { charWhitelist: psm === 8 ? "0123456789Oo" : "0123456789, ." } : {}) });
      text.push(...result.map(line => line.text));
    }
    return text;
  }

  if (kind === "weekly_overview") {
    const top = toOriginalY(title.bbox.y1) + width * config.weekScoreYFromHeader;
    fields.leftPoints = await readField(config.weekLeftX, top, config.weekScoreWidth, config.weekScoreHeight, "dark", true, true, 8);
    fields.rightPoints = await readField(config.weekRightX, top, config.weekScoreWidth, config.weekScoreHeight, "dark", true, true, 8);
  } else {
    const day = lines.find(line => line.bbox && /\b(?:Day|Dia)[^\d\r\n]{0,3}[1-6]\b/i.test(line.text) && line.bbox.x0 <= config.processedWidth * .65 && line.bbox.x1 >= config.processedWidth * .35);
    const dayBottom = day?.bbox ? toOriginalY(day.bbox.y1) : toOriginalY(title.bbox.y1) + width * .112;
    fields.leftTag = await readField(config.dayLeftTagX, dayBottom + width * config.dayTagYFromDay, config.dayLeftTagWidth, config.dayTagHeight, "light", false, false);
    fields.rightTag = await readField(config.dayRightTagX, dayBottom + width * config.dayTagYFromDay, config.dayRightTagWidth, config.dayTagHeight, "light", false, false);
    fields.leftScore = await readField(config.dayLeftScoreX, dayBottom + width * config.dayScoreYFromDay, config.dayScoreWidth, config.dayScoreHeight, "light", true, false);
    fields.rightScore = await readField(config.dayRightScoreX, dayBottom + width * config.dayScoreYFromDay, config.dayRightScoreWidth, config.dayRightScoreHeight, "light", true, true);
  }
  return parseVsCaptureLines({ kind, lines, imageWidth: config.processedWidth, fields });
}

export async function parseVsCaptureImageAuto(bytes: Buffer, requestedKind: VsVideoRequestedKind = "auto"): Promise<VsCaptureCandidate> {
  if (requestedKind !== "auto") return parseVsCaptureImage(bytes, requestedKind);
  try {
    return await parseVsCaptureImage(bytes, "daily_totals");
  } catch (error) {
    if (!(error instanceof VsPerformanceError) || error.code !== "capture_failed") throw error;
  }
  try {
    return await parseVsCaptureImage(bytes, "weekly_overview", true);
  } catch (error) {
    if (error instanceof VsPerformanceError && error.code === "capture_failed") throw new VsPerformanceError("capture_kind_unknown", 422);
    throw error;
  }
}
