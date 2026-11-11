import "server-only";

import sharp from "sharp";

import { runTesseract, type OcrLineResult } from "@/lib/members/roster-ocr/tesseract";
import type { OcrEntry } from "@/lib/video/normalize-rows";
import type { OcrAllFramesResult } from "@/lib/video/ocr-pipeline";
import type { VideoOcrProgressCallback } from "@/lib/video/ocr-provider.shared";
import {
  cleanVsRankingName,
  detectVsRankingCards,
  isVsRankingName,
  repairVsRankingScore,
  scoreHasExtraNarrowDigit,
  type VsRankingCard,
} from "@/lib/video/vs-ranking-cards";

export function parseVsScoreLines(lines: readonly OcrLineResult[]): OcrEntry[] {
  const groups: OcrLineResult[][] = [];
  for (const line of lines) {
    const box = line.bbox;
    const group = box && groups.find((group) => {
      const other = group[0].bbox;
      if (!other) return false;
      const overlap = Math.min(box.y1, other.y1) - Math.max(box.y0, other.y0);
      return overlap > 0 && overlap >= Math.min(box.y1 - box.y0, other.y1 - other.y0) * 0.5;
    });
    if (group) group.push(line);
    else groups.push([line]);
  }

  const entries: OcrEntry[] = [];
  for (const group of groups) {
    const text = group
      .sort((a, b) => (a.bbox?.x0 ?? 0) - (b.bbox?.x0 ?? 0))
      .map((line) => line.text.trim())
      .join(" ")
      .replace(/\s+/g, " ");
    const match = text.match(/^(?:(\d{1,3})[.)]?\s+)?(.+?)\s+(\d{1,3}(?:[, .]\d{3})+|\d+)$/u);
    if (!match) continue;
    const rank = match[1] ? Number(match[1]) : undefined;
    const name = match[2].trim();
    const score = match[3].replace(/[, .]/g, "");
    if (
      (rank != null && (rank < 1 || rank > 200)) ||
      !/[\p{L}]/u.test(name) ||
      /^(?:(?:weekly|daily|alliance|my|your|total)\s+(?:total|points|score)|pontua[çc][aã]o|pontos|total)\b/iu.test(name) ||
      (rank == null && score.length < 4) ||
      !Number.isSafeInteger(Number(score))
    ) continue;
    entries.push({ ...(rank == null ? {} : { rank }), name, score });
  }
  return entries;
}

const VS_RANKING_WIDTH = 1400;
const SCORE_WHITELIST = "0123456789,.";

type Crop = { left: number; top: number; width: number; height: number };

function cardHeight(card: VsRankingCard): number {
  return card.y1 - card.y0;
}

function nameCrop(width: number, card: VsRankingCard, wider = false): Crop {
  const height = cardHeight(card);
  return wider
    ? {
        left: Math.round(width * 0.32),
        top: card.y0 + Math.round(height * 0.08),
        width: Math.round(width * 0.34),
        height: Math.round(height * 0.42),
      }
    : {
        left: Math.round(width * 0.37),
        top: card.y0 + Math.round(height * 0.08),
        width: Math.round(width * 0.29),
        height: Math.round(height * 0.42),
      };
}

function scoreCrop(width: number, card: VsRankingCard, wider = false): Crop {
  const height = cardHeight(card);
  // Right-aligned points. A tight crop clips the last digit; grayscale
  // normalize washes brown digits off the bronze card, so the first pass
  // stays in color.
  return wider
    ? {
        left: Math.round(width * 0.52),
        top: card.y0 + Math.round(height * 0.12),
        width: Math.round(width * 0.46),
        height: Math.round(height * 0.74),
      }
    : {
        left: Math.round(width * 0.58),
        top: card.y0 + Math.round(height * 0.18),
        width: Math.round(width * 0.4),
        height: Math.round(height * 0.62),
      };
}

async function ocrVsCrop(
  png: Buffer,
  imageWidth: number,
  imageHeight: number,
  region: Crop,
  options: { whitelist?: string; boost?: boolean; scale?: number } = {},
): Promise<string> {
  const left = Math.max(0, Math.round(region.left));
  const top = Math.max(0, Math.round(region.top));
  const width = Math.min(imageWidth - left, Math.round(region.width));
  const height = Math.min(imageHeight - top, Math.round(region.height));
  if (width < 12 || height < 12) return "";
  let pipeline = sharp(png).extract({ left, top, width, height }).resize({
    width: Math.max(24, width * (options.scale ?? 3)),
    withoutEnlargement: false,
  });
  if (options.boost) pipeline = pipeline.grayscale().normalize().sharpen();
  const crop = await pipeline.png().toBuffer();
  const lines = await runTesseract(crop, {
    tesseractPsm: 7,
    minWordConfidence: 0,
    ...(options.whitelist ? { charWhitelist: options.whitelist } : {}),
  });
  return lines.map((line) => line.text).join(" ").trim();
}

async function readScore(
  png: Buffer,
  raw: Buffer,
  channels: number,
  width: number,
  height: number,
  card: VsRankingCard,
  region: Crop,
): Promise<string | null> {
  const text = await ocrVsCrop(png, width, height, region, {
    whitelist: SCORE_WHITELIST,
    scale: 4,
  });
  const digits = text.replace(/\D/g, "").length;
  return repairVsRankingScore(text, {
    extraNarrowDigit: scoreHasExtraNarrowDigit(raw, channels, width, card, digits),
  });
}

async function readRankingCard(
  png: Buffer,
  raw: Buffer,
  channels: number,
  width: number,
  height: number,
  card: VsRankingCard,
): Promise<OcrEntry | null> {
  let name = cleanVsRankingName(await ocrVsCrop(png, width, height, nameCrop(width, card)));
  if (!isVsRankingName(name)) {
    name = cleanVsRankingName(
      await ocrVsCrop(png, width, height, nameCrop(width, card, true)),
    );
  }
  if (!isVsRankingName(name)) return null;
  let score = await readScore(png, raw, channels, width, height, card, scoreCrop(width, card));
  if (!score) {
    score = await readScore(
      png,
      raw,
      channels,
      width,
      height,
      card,
      scoreCrop(width, card, true),
    );
  }
  if (!score) return null;
  return { name, score };
}

/** Colored ranking cards. Null when this frame is not that screen. */
async function readVsRankingFrame(buffer: Buffer): Promise<OcrEntry[] | null> {
  const prepared = sharp(buffer)
    .rotate()
    .resize({ width: VS_RANKING_WIDTH, withoutEnlargement: false });
  const [pngResult, rawResult] = await Promise.all([
    prepared.clone().png().toBuffer({ resolveWithObject: true }),
    prepared.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  const width = pngResult.info.width;
  const height = pngResult.info.height;
  const cards = detectVsRankingCards(
    rawResult.data,
    rawResult.info.channels,
    width,
    height,
  );
  if (cards.length < 2) return null;
  const entries: OcrEntry[] = [];
  for (const card of cards) {
    const entry = await readRankingCard(
      pngResult.data,
      rawResult.data,
      rawResult.info.channels,
      width,
      height,
      card,
    );
    if (entry) entries.push(entry);
  }
  return entries.length >= 2 ? entries : null;
}

async function readFlatScoreboard(buffer: Buffer): Promise<OcrEntry[]> {
  const image = await sharp(buffer)
    .rotate()
    .resize({ width: 1800, withoutEnlargement: false })
    .grayscale()
    .normalize()
    .png()
    .toBuffer();
  const lines = await runTesseract(image, { tesseractPsm: 6, minWordConfidence: 0 });
  return parseVsScoreLines(lines);
}

export async function ocrVsNativeFrames(
  frames: Array<{ index: number; buffer: Buffer }>,
  options?: { onProgress?: VideoOcrProgressCallback },
): Promise<OcrAllFramesResult> {
  const entries: OcrEntry[] = [];
  const frameTimings: OcrAllFramesResult["frameTimings"] = [];
  for (const [offset, frame] of frames.entries()) {
    const started = Date.now();
    const ranked = await readVsRankingFrame(frame.buffer);
    const parsed = (ranked ?? (await readFlatScoreboard(frame.buffer))).map((entry) => ({
      ...entry,
      _sourceFrameIndex: frame.index,
    }));
    entries.push(...parsed);
    const ms = Date.now() - started;
    frameTimings.push({
      frameIndex: frame.index,
      ms,
      uploadMs: 0,
      extractMs: ms,
      entryCount: parsed.length,
      error: null,
      rawResult: { entries: parsed },
    });
    await options?.onProgress?.(offset + 1, frames.length);
  }
  return { entries, observations: entries, frameTimings, concurrency: 1 };
}
