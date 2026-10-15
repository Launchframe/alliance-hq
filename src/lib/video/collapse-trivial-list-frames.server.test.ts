import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import sharp from "sharp";

import {
  buildListFrameSignature,
  collapseTrivialListFrames,
  findHorizontalTextPeaks,
  LIST_FRAME_STRIP_MAX_MEAN_DIFF,
  meanAbsDistance,
  stripDistanceWithVerticalAlign,
} from "@/lib/video/collapse-trivial-list-frames.server";
import type { ExtractedFrame } from "@/lib/video/frame-extractor";

const WIDTH = 200;
const HEIGHT = 320;
const ROW_PITCH = 28;
const ROW_BAND = 12;

type RowSpec = { label: string; fill: number };

/**
 * Synthetic scrolling list: dark bg + textured horizontal bands (vertical
 * bars mimic glyphs so horizontal energy peaks sit on real row centers).
 */
async function listFramePng(
  rows: RowSpec[],
  options?: { shiftY?: number; blur?: boolean },
): Promise<Buffer> {
  const shiftY = options?.shiftY ?? 0;
  const startY = 40 + shiftY;
  const rects = rows
    .map((row, i) => {
      const y = startY + i * ROW_PITCH;
      if (y < 0 || y + ROW_BAND > HEIGHT) return "";
      const gray = row.fill;
      const bars: string[] = [];
      // Distinct bar pattern per row so one-row scrolls change strip content.
      const seed = row.fill;
      for (let x = 24; x < 176; x += 6) {
        const on = ((x + seed) * 17) % 11 > 4;
        if (!on) continue;
        const g = Math.min(255, gray + ((x + seed) % 40));
        bars.push(
          `<rect x="${x}" y="${y + 2}" width="3" height="${ROW_BAND - 4}" fill="rgb(${g},${g},${g})"/>`,
        );
      }
      return `<rect x="20" y="${y}" width="160" height="${ROW_BAND}" fill="rgb(${Math.max(30, gray - 80)},${Math.max(30, gray - 80)},${Math.max(30, gray - 80)})"/>${bars.join("")}`;
    })
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
    <rect width="${WIDTH}" height="${HEIGHT}" fill="rgb(20,20,20)"/>
    ${rects}
  </svg>`;
  let pipeline = sharp(Buffer.from(svg)).png();
  if (options?.blur) {
    pipeline = pipeline.blur(1.5);
  }
  return pipeline.toBuffer();
}

function asExtracted(index: number, buffer: Buffer): ExtractedFrame {
  return {
    index,
    filePath: `/tmp/frame_${index}.png`,
    buffer,
    videoTimestampSeconds: index * 0.3,
  };
}

const BASE_ROWS: RowSpec[] = [
  { label: "A", fill: 220 },
  { label: "B", fill: 200 },
  { label: "C", fill: 180 },
  { label: "D", fill: 160 },
  { label: "E", fill: 140 },
  { label: "F", fill: 120 },
  { label: "G", fill: 100 },
  { label: "H", fill: 80 },
];

describe("meanAbsDistance", () => {
  it("is zero for identical buffers and grows with difference", () => {
    const a = new Uint8Array([10, 20, 30]);
    expect(meanAbsDistance(a, a)).toBe(0);
    expect(meanAbsDistance(a, new Uint8Array([20, 30, 40]))).toBeCloseTo(10);
    expect(meanAbsDistance(a, new Uint8Array(2))).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("findHorizontalTextPeaks", () => {
  it("finds multiple peaks on a synthetic list frame", async () => {
    const png = await listFramePng(BASE_ROWS);
    const { data, info } = await sharp(png)
      .resize({ width: 160, withoutEnlargement: true })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { peaks, reliable } = findHorizontalTextPeaks(
      new Uint8Array(data),
      info.width,
      info.height,
    );
    expect(reliable).toBe(true);
    expect(peaks.length).toBeGreaterThanOrEqual(3);
  });

  it("fails open on a flat image", async () => {
    const png = await sharp({
      create: {
        width: 160,
        height: 200,
        channels: 3,
        background: { r: 40, g: 40, b: 40 },
      },
    })
      .png()
      .toBuffer();
    const { data, info } = await sharp(png)
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { reliable, peaks } = findHorizontalTextPeaks(
      new Uint8Array(data),
      info.width,
      info.height,
    );
    expect(reliable).toBe(false);
    expect(peaks.length).toBeLessThan(3);
  });
});

describe("collapseTrivialListFrames", () => {
  it("drops an identical consecutive frame", async () => {
    const a = await listFramePng(BASE_ROWS);
    const result = await collapseTrivialListFrames([
      asExtracted(0, a),
      asExtracted(1, Buffer.from(a)),
    ]);
    expect(result.keptCount).toBe(1);
    expect(result.dropped).toHaveLength(1);
    expect(result.frames[0]!.index).toBe(0);
    expect(result.frames[0]!.videoTimestampSeconds).toBe(0);
  });

  it("drops a 2px vertical shift of the same list window", async () => {
    const base = await listFramePng(BASE_ROWS);
    const shifted = await listFramePng(BASE_ROWS, { shiftY: 2 });
    const baseSig = await buildListFrameSignature(base);
    const shiftedSig = await buildListFrameSignature(shifted);
    expect(baseSig.reliable).toBe(true);
    expect(shiftedSig.reliable).toBe(true);
    expect(baseSig.topStrip).not.toBeNull();
    expect(shiftedSig.topStrip).not.toBeNull();
    const topDist = stripDistanceWithVerticalAlign(
      baseSig.topStrip!,
      shiftedSig.topStrip!,
    );
    const botDist = stripDistanceWithVerticalAlign(
      baseSig.bottomStrip!,
      shiftedSig.bottomStrip!,
    );
    expect(topDist).toBeLessThan(LIST_FRAME_STRIP_MAX_MEAN_DIFF);
    expect(botDist).toBeLessThan(LIST_FRAME_STRIP_MAX_MEAN_DIFF);

    const result = await collapseTrivialListFrames([
      asExtracted(0, base),
      asExtracted(1, shifted),
    ]);
    expect(result.keptCount).toBe(1);
    expect(result.dropped).toHaveLength(1);
    expect(["end_rows", "whole_frame"]).toContain(result.dropped[0]!.reason);
  });

  it("keeps a one-row scroll (top and/or bottom content changes)", async () => {
    const base = await listFramePng(BASE_ROWS);
    // Distinct fills / bar seeds so end-row strips diverge clearly from a
    // 2px jitter of the same window.
    const scrolledRows: RowSpec[] = [
      { label: "B", fill: 40 },
      { label: "C", fill: 70 },
      { label: "D", fill: 100 },
      { label: "E", fill: 130 },
      { label: "F", fill: 160 },
      { label: "G", fill: 190 },
      { label: "H", fill: 220 },
      { label: "I", fill: 250 },
    ];
    const scrolled = await listFramePng(scrolledRows);
    const result = await collapseTrivialListFrames([
      asExtracted(0, base),
      asExtracted(1, scrolled),
    ]);
    expect(result.keptCount).toBe(2);
    expect(result.dropped).toHaveLength(0);
    expect(result.frames.map((f) => f.index)).toEqual([0, 1]);
    expect(result.frames[1]!.videoTimestampSeconds).toBe(0.3);
  });

  it("keeps frames when the signature is too weak", async () => {
    const flat = await sharp({
      create: {
        width: WIDTH,
        height: HEIGHT,
        channels: 3,
        background: { r: 30, g: 30, b: 30 },
      },
    })
      .png()
      .toBuffer();
    const result = await collapseTrivialListFrames([
      asExtracted(0, flat),
      asExtracted(1, flat),
    ]);
    // Whole-frame fingerprint still collapses true pauses even without peaks.
    // Use a second flat with a different solid color so whole FP diverges and
    // end-row path is the only possible collapse (which must fail open).
    const other = await sharp({
      create: {
        width: WIDTH,
        height: HEIGHT,
        channels: 3,
        background: { r: 90, g: 90, b: 90 },
      },
    })
      .png()
      .toBuffer();
    const weak = await collapseTrivialListFrames([
      asExtracted(0, flat),
      asExtracted(1, other),
    ]);
    expect(weak.keptCount).toBe(2);
    expect(weak.dropped).toHaveLength(0);
    // Document identical flat still collapses via whole-frame path.
    expect(result.keptCount).toBe(1);
  });

  it("replaces a blurrier kept frame with a sharper trivial duplicate", async () => {
    const sharpFrame = await listFramePng(BASE_ROWS);
    const blurry = await listFramePng(BASE_ROWS, { blur: true });
    const blurSig = await buildListFrameSignature(blurry);
    const sharpSig = await buildListFrameSignature(sharpFrame);
    expect(sharpSig.sharpness).toBeGreaterThan(blurSig.sharpness);

    const result = await collapseTrivialListFrames([
      asExtracted(0, blurry),
      asExtracted(1, sharpFrame),
    ]);
    expect(result.keptCount).toBe(1);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]!.replacedPrevious).toBe(true);
    // Kept buffer should be the sharper capture (original index 1 content).
    expect(result.frames[0]!.buffer.equals(sharpFrame)).toBe(true);
    expect(result.frames[0]!.videoTimestampSeconds).toBe(0.3);
  });
});
