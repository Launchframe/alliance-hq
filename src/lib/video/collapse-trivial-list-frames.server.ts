import "server-only";

import sharp from "sharp";

import type { ExtractedFrame } from "@/lib/video/frame-extractor";

/** Analysis width for peak detection and strip fingerprints (keeps cost low). */
export const LIST_FRAME_ANALYSIS_WIDTH = 160;

/** Whole-frame fingerprint size (matches chat near-duplicate collapse). */
export const LIST_FRAME_FINGERPRINT_SIZE = 16;

/** Mean abs greyscale distance under which consecutive whole frames are pauses. */
export const LIST_FRAME_WHOLE_MAX_MEAN_DIFF = 2.0;

/**
 * Mean abs greyscale distance under which a snapped row strip still matches.
 * Tuned from synthetic list fixtures: ~2px peak-snap jitter across *all*
 * row strips lands under ~10, while a one-row advance or a middle-row glyph
 * change lands above that.
 */
export const LIST_FRAME_STRIP_MAX_MEAN_DIFF = 10;

/** Normalized strip size used for row-strip comparison. */
export const LIST_FRAME_STRIP_WIDTH = 64;
/** Tall enough for ±2 row align search after peak snap. */
export const LIST_FRAME_STRIP_HEIGHT = 16;

/** Ignore status-bar / home-indicator bands when hunting row peaks. */
export const LIST_FRAME_EDGE_MARGIN_RATIO = 0.08;

/** Need at least this many in-list text peaks or we fail open (keep the frame). */
export const LIST_FRAME_MIN_PEAKS = 3;

export type ListFrameSignature = {
  /** False when peak detection is too weak — callers must keep the frame. */
  reliable: boolean;
  sharpness: number;
  wholeFingerprint: Uint8Array;
  /** One downsampled strip per detected text-row peak (top → bottom). */
  rowStrips: Uint8Array[];
  peakCount: number;
};

export type TrivialCollapseDrop = {
  originalIndex: number;
  reason: "whole_frame" | "row_strips";
  wholeDistance: number;
  /** Per-row strip distances when the row-strip path decided; null on fail-open. */
  stripDistances: number[] | null;
  maxStripDistance: number | null;
  replacedPrevious: boolean;
};

export type CollapseTrivialListFramesResult = {
  frames: ExtractedFrame[];
  inputCount: number;
  keptCount: number;
  dropped: TrivialCollapseDrop[];
};

export function meanAbsDistance(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length || a.length === 0) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += Math.abs(a[i]! - b[i]!);
  }
  return sum / a.length;
}

function medianPositive(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

/**
 * Find horizontal text-row peaks from a grayscale raw image.
 * Exported for unit tests with synthetic energy patterns via real images.
 */
export function findHorizontalTextPeaks(
  data: Uint8Array,
  width: number,
  height: number,
  options?: { edgeMarginRatio?: number; minPeaks?: number },
): { peaks: number[]; reliable: boolean } {
  const edgeMarginRatio = options?.edgeMarginRatio ?? LIST_FRAME_EDGE_MARGIN_RATIO;
  const minPeaks = options?.minPeaks ?? LIST_FRAME_MIN_PEAKS;
  if (width < 4 || height < 16) {
    return { peaks: [], reliable: false };
  }

  const energy = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    let sum = 0;
    const row = y * width;
    for (let x = 1; x < width; x++) {
      sum += Math.abs(data[row + x]! - data[row + x - 1]!);
    }
    energy[y] = sum / (width - 1);
  }

  const smooth = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    let s = 0;
    let c = 0;
    for (let k = -2; k <= 2; k++) {
      const yy = y + k;
      if (yy >= 0 && yy < height) {
        s += energy[yy]!;
        c += 1;
      }
    }
    smooth[y] = s / c;
  }

  const margin = Math.max(2, Math.floor(height * edgeMarginRatio));
  const innerStart = margin;
  const innerEnd = height - margin;
  if (innerEnd - innerStart < 8) {
    return { peaks: [], reliable: false };
  }

  let mean = 0;
  for (let y = innerStart; y < innerEnd; y++) {
    mean += smooth[y]!;
  }
  mean /= innerEnd - innerStart;
  const threshold = Math.max(mean * 1.25, 2);

  const peaks: number[] = [];
  for (let y = innerStart + 1; y < innerEnd - 1; y++) {
    const v = smooth[y]!;
    if (v < threshold) continue;
    if (v >= smooth[y - 1]! && v >= smooth[y + 1]!) {
      // Suppress plateaus: keep only first of a flat run.
      if (peaks.length > 0 && y - peaks[peaks.length - 1]! <= 2) {
        const prev = peaks[peaks.length - 1]!;
        if (smooth[y]! > smooth[prev]!) {
          peaks[peaks.length - 1] = y;
        }
        continue;
      }
      peaks.push(y);
    }
  }

  return { peaks, reliable: peaks.length >= minPeaks };
}

function extractCenteredStrip(
  data: Uint8Array,
  width: number,
  height: number,
  peakY: number,
  stripHalfHeight: number,
): { pixels: Uint8Array; height: number } {
  const y0 = Math.max(0, peakY - stripHalfHeight);
  const y1 = Math.min(height, peakY + stripHalfHeight + 1);
  const outH = y1 - y0;
  const strip = new Uint8Array(width * outH);
  for (let y = 0; y < outH; y++) {
    const src = (y0 + y) * width;
    const dst = y * width;
    strip.set(data.subarray(src, src + width), dst);
  }
  return { pixels: strip, height: outH };
}

async function downsampleStrip(
  strip: Uint8Array,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const buf = await sharp(strip, {
    raw: { width, height, channels: 1 },
  })
    .resize(LIST_FRAME_STRIP_WIDTH, LIST_FRAME_STRIP_HEIGHT, { fit: "fill" })
    .raw()
    .toBuffer();
  return new Uint8Array(buf);
}

/**
 * Mean abs distance with a small vertical search so 1–2px peak-snap error
 * (or residual scroll jitter) does not keep a trivial duplicate.
 */
export function stripDistanceWithVerticalAlign(
  a: Uint8Array,
  b: Uint8Array,
  maxShiftRows = 2,
): number {
  if (a.length !== b.length || a.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  const width = LIST_FRAME_STRIP_WIDTH;
  const height = LIST_FRAME_STRIP_HEIGHT;
  if (a.length !== width * height) {
    return meanAbsDistance(a, b);
  }

  let best = Number.POSITIVE_INFINITY;
  for (let shift = -maxShiftRows; shift <= maxShiftRows; shift++) {
    let sum = 0;
    let count = 0;
    for (let y = 0; y < height; y++) {
      const yb = y + shift;
      if (yb < 0 || yb >= height) continue;
      const rowA = y * width;
      const rowB = yb * width;
      for (let x = 0; x < width; x++) {
        sum += Math.abs(a[rowA + x]! - b[rowB + x]!);
        count += 1;
      }
    }
    if (count > 0) {
      best = Math.min(best, sum / count);
    }
  }
  return best;
}

/**
 * Build a list-frame signature: whole-frame fingerprint + one strip per peak.
 * Fail-open (`reliable: false`) when fewer than {@link LIST_FRAME_MIN_PEAKS} peaks.
 */
export async function buildListFrameSignature(
  buffer: Buffer,
): Promise<ListFrameSignature> {
  const pipeline = sharp(buffer).rotate();
  const [stats, wholeFp, analyzed] = await Promise.all([
    pipeline.clone().grayscale().stats(),
    pipeline
      .clone()
      .resize(LIST_FRAME_FINGERPRINT_SIZE, LIST_FRAME_FINGERPRINT_SIZE, {
        fit: "fill",
      })
      .grayscale()
      .raw()
      .toBuffer(),
    pipeline
      .clone()
      .resize({ width: LIST_FRAME_ANALYSIS_WIDTH, withoutEnlargement: true })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true }),
  ]);

  const channel = stats.channels[0];
  const sharpness = Math.min(1, (channel?.stdev ?? 0) / 64);
  const wholeFingerprint = new Uint8Array(wholeFp);
  const { data, info } = analyzed;
  const width = info.width;
  const height = info.height;
  const pixels = new Uint8Array(data);

  const { peaks, reliable } = findHorizontalTextPeaks(pixels, width, height);
  if (!reliable) {
    return {
      reliable: false,
      sharpness,
      wholeFingerprint,
      rowStrips: [],
      peakCount: peaks.length,
    };
  }

  const pitches: number[] = [];
  for (let i = 1; i < peaks.length; i++) {
    pitches.push(peaks[i]! - peaks[i - 1]!);
  }
  const medianPitch = medianPositive(pitches) ?? 12;
  const stripHalfHeight = Math.max(2, Math.round(0.3 * medianPitch));
  // Pad half-height so vertical align can absorb residual peak-snap error.
  const paddedHalf = stripHalfHeight + 2;

  const rowStrips = await Promise.all(
    peaks.map(async (peakY) => {
      const raw = extractCenteredStrip(
        pixels,
        width,
        height,
        peakY,
        paddedHalf,
      );
      return downsampleStrip(raw.pixels, width, raw.height);
    }),
  );

  return {
    reliable: true,
    sharpness,
    wholeFingerprint,
    rowStrips,
    peakCount: peaks.length,
  };
}

/**
 * Require every corresponding row strip under the threshold.
 * Peak-count mismatch or missing strips fail open (do not collapse).
 */
export function rowStripsMatch(
  prev: ListFrameSignature,
  next: ListFrameSignature,
): {
  match: boolean;
  stripDistances: number[] | null;
  maxStripDistance: number | null;
} {
  if (
    !prev.reliable ||
    !next.reliable ||
    prev.rowStrips.length === 0 ||
    next.rowStrips.length === 0 ||
    prev.rowStrips.length !== next.rowStrips.length
  ) {
    return { match: false, stripDistances: null, maxStripDistance: null };
  }

  const stripDistances: number[] = [];
  let maxStripDistance = 0;
  for (let i = 0; i < prev.rowStrips.length; i++) {
    const distance = stripDistanceWithVerticalAlign(
      prev.rowStrips[i]!,
      next.rowStrips[i]!,
    );
    stripDistances.push(distance);
    if (distance > maxStripDistance) maxStripDistance = distance;
  }

  return {
    match: stripDistances.every((d) => d < LIST_FRAME_STRIP_MAX_MEAN_DIFF),
    stripDistances,
    maxStripDistance,
  };
}

type AnnotatedFrame = {
  frame: ExtractedFrame;
  signature: ListFrameSignature;
  originalIndex: number;
};

/**
 * Drop consecutive frames whose visible list window has not materially changed.
 *
 * - Whole-frame near-identical pauses collapse (chat-style fingerprint).
 * - Otherwise every snapped row strip must match the previous kept frame.
 * - Weak signatures / peak-count mismatch fail open (frame kept).
 * - Among a trivial run, keep the sharpest capture.
 * - Kept frames are reindexed from 0; `videoTimestampSeconds` is preserved.
 */
export async function collapseTrivialListFrames(
  frames: readonly ExtractedFrame[],
): Promise<CollapseTrivialListFramesResult> {
  if (frames.length <= 1) {
    return {
      frames: frames.map((frame, index) => ({ ...frame, index })),
      inputCount: frames.length,
      keptCount: frames.length,
      dropped: [],
    };
  }

  const annotated: AnnotatedFrame[] = [];
  for (const frame of frames) {
    annotated.push({
      frame,
      signature: await buildListFrameSignature(frame.buffer),
      originalIndex: frame.index,
    });
  }

  const kept: AnnotatedFrame[] = [];
  const dropped: TrivialCollapseDrop[] = [];

  for (const current of annotated) {
    const last = kept[kept.length - 1];
    if (!last) {
      kept.push(current);
      continue;
    }

    const wholeDistance = meanAbsDistance(
      last.signature.wholeFingerprint,
      current.signature.wholeFingerprint,
    );
    const rows = rowStripsMatch(last.signature, current.signature);

    const trivialWhole = wholeDistance < LIST_FRAME_WHOLE_MAX_MEAN_DIFF;
    const trivialRows = rows.match;
    if (!trivialWhole && !trivialRows) {
      kept.push(current);
      continue;
    }

    const replacedPrevious = current.signature.sharpness > last.signature.sharpness;
    if (replacedPrevious) {
      kept[kept.length - 1] = current;
    }
    dropped.push({
      originalIndex: current.originalIndex,
      reason: trivialWhole ? "whole_frame" : "row_strips",
      wholeDistance,
      stripDistances: rows.stripDistances,
      maxStripDistance: rows.maxStripDistance,
      replacedPrevious,
    });
  }

  const outFrames = kept.map((item, index) => ({
    ...item.frame,
    index,
  }));

  return {
    frames: outFrames,
    inputCount: frames.length,
    keptCount: outFrames.length,
    dropped,
  };
}
