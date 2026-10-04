import "server-only";

import sharp from "sharp";
import { runTesseract, type OcrLineResult } from "@/lib/members/roster-ocr/tesseract";
import { frontlinePositiveInteger, normalizeFrontlineScore, type FrontlineEntry } from "@/lib/video/frontline-breakthrough.shared";
import type { OcrAllFramesResult } from "@/lib/video/ocr-pipeline";
import type { VideoOcrProgressCallback } from "@/lib/video/ocr-provider.shared";

const STAGE_PATTERN = /(?:stage|fase|etapa|est[aá]gio)\s*(\d+)?/iu;

type Region = { left: number; top: number; width: number; height: number };

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)] ?? 0;
}

export async function frontlineAllianceTabAnchor(image: Buffer, lines: readonly OcrLineResult[], width: number): Promise<number | null> {
  const header = lines.find((line) => /\branking\b/iu.test(line.text) && line.bbox && line.bbox.y0 < width * 0.3);
  if (!header?.bbox) return null;
  const tabs = [
    lines.find((line) => /alliance|alian[cç]a/iu.test(line.text) && line.bbox && line.bbox.x0 < width / 3 && line.bbox.y0 > header.bbox!.y1 && line.bbox.y1 < header.bbox!.y1 + width * 0.16),
    lines.find((line) => /warzone|zona.*guerra/iu.test(line.text) && line.bbox && line.bbox.x0 > width / 3 && line.bbox.x0 < width * 2 / 3),
    lines.find((line) => /master|leaderboard|mestre/iu.test(line.text) && line.bbox && line.bbox.x0 > width * 2 / 3),
  ];
  if (!tabs[0]?.bbox && tabs[1]?.bbox && tabs[2]?.bbox) {
    const left = Math.round(width * 0.085);
    const top = Math.max(0, Math.round(tabs[1].bbox.y0 - width * 0.015));
    const cropped = await sharp(image).extract({ left, top, width: Math.round(width * 0.23), height: Math.round(width * 0.055) }).normalize().png().toBuffer();
    const label = (await runTesseract(cropped, { tesseractPsm: 7, minWordConfidence: 0 })).find((line) => /alliance|alian[cç]a/iu.test(line.text) && line.bbox);
    if (label?.bbox) tabs[0] = { ...label, bbox: { x0: label.bbox.x0 + left, x1: label.bbox.x1 + left, y0: label.bbox.y0 + top, y1: label.bbox.y1 + top } };
  }
  if (tabs.some((tab) => !tab?.bbox)) return null;
  const boxes = tabs.map((tab) => tab!.bbox!);
  if (Math.max(...boxes.map((box) => box.y0)) - Math.min(...boxes.map((box) => box.y0)) > width * 0.025) return null;
  const brightness = await Promise.all(boxes.map(async (box) => {
    const { data } = await sharp(image).extract({
      left: box.x0, top: Math.max(0, Math.round(box.y0 - width * 0.012)),
      width: box.x1 - box.x0, height: Math.max(1, Math.round(width * 0.006)),
    }).grayscale().raw().toBuffer({ resolveWithObject: true });
    return median([...data]);
  }));
  if (brightness[0] < 145 || brightness[0] - Math.max(brightness[1], brightness[2]) < 35) return null;
  return median(boxes.map((box) => box.y0)) / width;
}

export async function parseFrontlineImage(buffer: Buffer): Promise<{ selectedTab: "alliance" | "unknown"; entries: FrontlineEntry[] }> {
  const { data: image, info } = await sharp(buffer).rotate().flatten({ background: "white" }).removeAlpha().resize({ width: 1260 }).grayscale().normalize().png().toBuffer({ resolveWithObject: true });
  const width = info.width;
  const lines = await runTesseract(image, { tesseractPsm: 11, minWordConfidence: 0 });
  const anchor = await frontlineAllianceTabAnchor(image, lines, width);
  if (anchor == null) return { selectedTab: "unknown", entries: [] };
  const shift = anchor - 0.163;
  const crop = async (region: Region, numeric = false, outlined = false): Promise<string> => {
    const left = Math.max(0, Math.round(region.left * width));
    const top = Math.max(0, Math.round(region.top * width));
    const cropWidth = Math.min(Math.round(region.width * width), info.width - left);
    const cropHeight = Math.min(Math.round(region.height * width), info.height - top);
    if (cropWidth <= 0 || cropHeight <= 0) return "";
    const pipeline = sharp(image).extract({ left, top, width: cropWidth, height: cropHeight });
    if (outlined) pipeline.threshold(235).negate({ alpha: false });
    else pipeline.normalize();
    const pixels = await pipeline.png().toBuffer();
    const cropped = await sharp(pixels).extend({ top: 12, bottom: 12, left: 12, right: 12, background: "white" }).png().toBuffer();
    return (await runTesseract(cropped, { tesseractPsm: numeric ? 13 : 7, minWordConfidence: 0, ...(numeric ? { charWhitelist: "0123456789xX" } : {}) })).map((line) => line.text).join(" ").trim();
  };
  const readRank = async (region: Region): Promise<number | null> => {
    const left = Math.round(region.left * width);
    const top = Math.round(region.top * width);
    const rankWidth = Math.round(region.width * width);
    const rankHeight = Math.round(region.height * width);
    const pixels = await sharp(image).extract({ left, top, width: rankWidth, height: rankHeight }).grayscale().threshold(140).raw().toBuffer({ resolveWithObject: true });
    const spans: Array<{ left: number; right: number }> = [];
    let start: number | null = null;
    for (let x = 0; x <= rankWidth; x++) {
      let ink = 0;
      if (x < rankWidth) for (let y = 0; y < rankHeight; y++) {
        if (pixels.data[(y * rankWidth + x) * pixels.info.channels] < 128) ink++;
      }
      if (ink >= 3) {
        start ??= x;
      } else if (start != null) {
        if (x - start >= 3) spans.push({ left: start, right: x });
        start = null;
      }
    }
    if (!spans.length || spans.length > 4) return null;
    const observed = lines.filter((line) => line.bbox && line.bbox.y0 >= top && line.bbox.y1 <= top + rankHeight).flatMap((line) => line.words ?? []).find((word) => word.x0 >= left && word.x1 <= left + rankWidth && /^\d+$/.test(word.text) && word.text.length === spans.length);
    if (observed) return frontlinePositiveInteger(observed.text);
    const wholeText = await crop(region, true);
    if (/^\d+$/.test(wholeText) && wholeText.length === spans.length) return frontlinePositiveInteger(wholeText);
    let digits = "";
    for (const span of spans) {
      const glyph = await sharp(image).extract({ left: left + span.left, top, width: span.right - span.left, height: rankHeight }).removeAlpha().threshold(140).png().toBuffer();
      const padded = await sharp(glyph).extend({ top: 10, bottom: 10, left: 10, right: 10, background: "white" }).png().toBuffer();
      let text = "";
      for (const psm of [10, 13, 8] as const) {
        text = (await runTesseract(padded, { tesseractPsm: psm, minWordConfidence: 0, charWhitelist: "0123456789" })).map((line) => line.text).join("").trim();
        if (/^\d$/.test(text)) break;
      }
      if (!/^\d$/.test(text)) return null;
      digits += text;
    }
    return frontlinePositiveInteger(digits);
  };
  const entries: FrontlineEntry[] = [];
  for (const card of [
    { rank: 2, left: 0.065, nameTop: 0.684, stageTop: 0.724, scoreTop: 0.769 },
    { rank: 1, left: 0.386, nameTop: 0.622, stageTop: 0.670, scoreTop: 0.720 },
    { rank: 3, left: 0.708, nameTop: 0.681, stageTop: 0.724, scoreTop: 0.769 },
  ]) {
    const name = await crop({ left: card.left + (card.rank === 1 ? 0.067 : 0.004), top: card.nameTop + shift, width: card.rank === 1 ? 0.1 : 0.242, height: 0.032 });
    const stageText = await crop({ left: card.left + 0.047, top: card.stageTop + shift, width: 0.165, height: 0.043 }, false, true);
    const scoreText = await crop({ left: card.left + 0.086, top: card.scoreTop + shift, width: 0.139, height: 0.049 }, true, true);
    const stage = frontlinePositiveInteger(stageText.match(STAGE_PATTERN)?.[1]);
    const score = normalizeFrontlineScore(scoreText.replace(/^[xX]+/, "x"));
    if (name && score != null && STAGE_PATTERN.test(stageText)) entries.push({ name, score, frontlineStage: stage, rank: card.rank });
  }
  const anchors = lines.filter((line) => line.bbox && line.bbox.x0 > width * 0.78 && line.bbox.y0 > width * (0.85 + shift) && STAGE_PATTERN.test(line.text));
  for (const line of anchors) {
    const stage = frontlinePositiveInteger(line.text.match(STAGE_PATTERN)?.[1]);
    const top = line.bbox!.y0 / width;
    if ((top + 0.09) * width > info.height) continue;
    const nearby = lines.filter((other) => other.bbox && other.bbox.y0 >= (top + 0.009) * width && other.bbox.y0 <= (top + 0.085) * width);
    const nameWords = nearby.flatMap((other) => other.words ?? []).filter((word) => word.x0 >= width * 0.283 && word.x1 <= width * 0.77);
    const name = nameWords.map((word) => word.text).join(" ") || await crop({ left: 0.284, top: top + 0.014, width: 0.48, height: 0.054 });
    const rank = await readRank({ left: 0.065, top: top + 0.007, width: 0.10, height: 0.069 });
    const scoreLine = nearby.find((other) => other.bbox!.x0 >= width * 0.75 && /[xX×]\s*\d[\d, .]*$/u.test(other.text));
    const scoreText = scoreLine?.text.match(/[xX×]\s*(\d[\d, .]*)$/u)?.[1] ?? await crop({ left: 0.828, top: top + 0.043, width: 0.13, height: 0.055 }, true);
    const score = normalizeFrontlineScore(scoreText.replace(/^[xX]+/, "x"));
    if (name && score != null) entries.push({ name, score, frontlineStage: stage, ...(rank == null ? {} : { rank }) });
  }
  return { selectedTab: "alliance", entries };
}

export async function ocrFrontlineNativeFrames(
  frames: Array<{ index: number; buffer: Buffer }>,
  options?: { onProgress?: VideoOcrProgressCallback },
): Promise<OcrAllFramesResult> {
  const entries: FrontlineEntry[] = [];
  const frameTimings: OcrAllFramesResult["frameTimings"] = [];
  for (const [offset, frame] of frames.entries()) {
    const start = Date.now();
    const result = await parseFrontlineImage(frame.buffer);
    const observed = result.entries.map((entry) => ({ ...entry, _sourceFrameIndex: frame.index }));
    entries.push(...observed);
    const ms = Date.now() - start;
    frameTimings.push({ frameIndex: frame.index, ms, uploadMs: 0, extractMs: ms, entryCount: observed.length, error: null, rawResult: result });
    await options?.onProgress?.(offset + 1, frames.length);
  }
  return { entries, observations: entries, frameTimings, concurrency: 1 };
}
