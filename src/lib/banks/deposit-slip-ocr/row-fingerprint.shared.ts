/**
 * Cross-frame OCR row fingerprinting for the deposit-slip video pipeline.
 *
 * Deposit-slip frames are extracted at a heavier scan-fps than the visual scroll
 * needs (see `docs/guides/video-pipeline-configs.md`), so the same physical
 * card/line is often OCR'd many times across overlapping frames. The primary
 * native path OCRs frames in chunks, associates fields with line/word geometry,
 * then reconciles slip-level duplicates afterward (`dedupeDepositSlips` and
 * related merge rules in `deposit-slip-dedupe.shared.ts`).
 *
 * This module dedupes one level earlier, at the raw Tesseract *line* — before
 * any deposit-slip-specific parsing runs — using line `bbox` geometry that
 * `extractOcrLinesFromTesseractData` already exposes. No OpenCV, no extra
 * `recognize()` calls: still exactly one full-frame Tesseract pass per frame;
 * only the post-recognize handling of already-computed line geometry changes.
 *
 * Algorithm — a small sliding-window "row tracker" over frames in scroll order:
 *
 * 1. Each Tesseract line becomes a fingerprint candidate: normalized text +
 *    (if bbox present) a coarse vertical band, `y0 / frameHeight` bucketed to
 *    {@link DEFAULT_Y_BAND_BUCKET}.
 * 2. A candidate merges into an already-open row cluster when the cluster was
 *    last touched within {@link DEFAULT_FRAME_CONTINUITY_WINDOW} frames AND
 *    (when both have bands) the vertical band is close AND the text matches
 *    exactly or fuzzy-matches above {@link LINE_FUZZY_MATCH_THRESHOLD} (catches
 *    a single OCR digit/character misread of the *same* physical row across
 *    adjacent frames without conflating two different rows).
 * 3. Once a cluster hasn't been touched for more than the continuity window,
 *    it "expires" — closed out as one deduped line. A later line with the same
 *    (or very similar) text is treated as genuinely new, not re-absorbed. This
 *    is what keeps a rapid same-commander re-deposit (e.g. looted then
 *    re-deposited within minutes — the known limitation called out in
 *    `deposit-slip-dedupe.shared.ts` and `.cursor/rules/season-5-bank-deposits.mdc`)
 *    from being swallowed as "OCR noise of the earlier row", *as long as* the
 *    two occurrences are separated by more than the continuity window of
 *    frames — which cross-frame scroll overlap alone should not span.
 *
 * Output is a flat, deduped, frame-order-agnostic `string[]` — a drop-in input
 * for the existing `parseDepositSlipHistoryText(lines)`, unchanged.
 *
 * This module currently runs offline (spike harness) and as the
 * `deposit_slip_fingerprint_shadow` shadow pass — see
 * `process-deposit-slip-fingerprint-shadow-job.ts`. It is not yet wired into
 * the primary native OCR path (`ocr-deposit-slip-native.ts`).
 */

import { stringSimilarity } from "@/lib/video/member-matcher";

/** Tesseract line bounding box, `{x0,y0,x1,y1}` in processed-image pixel space. */
export type FingerprintBbox = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

/** Minimal shape this module needs from an extracted OCR line. */
export type FingerprintableOcrLine = {
  text: string;
  confidence: number;
  bbox?: FingerprintBbox | null;
  rowHeight?: number | null;
};

/** One frame's OCR lines, in original (top-to-bottom) order. */
export type OcrFrameLines = {
  frameIndex: number;
  lines: readonly FingerprintableOcrLine[];
  /**
   * Processed-image height in px — required to normalize `bbox.y0` into a
   * 0..1 band. Frames may vary in extracted resolution/aspect (frame width is
   * normalized on extraction, height is not — see `frame-extractor.ts`), so
   * bands are always relative to *this* frame's height, never a raw pixel
   * constant.
   */
  frameHeight: number;
};

export type DedupeOcrLinesOptions = {
  /**
   * Max frame-index gap for a repeat line to still count as an OCR re-read of
   * the same visual row rather than a genuinely new occurrence. Tuned against
   * real oversampled scan-fps footage during the spike run.
   */
  frameContinuityWindow?: number;
  /** Y-band bucket size, as a fraction (0..1) of frame height. */
  yBandBucketSize?: number;
  /** Fuzzy-match floor (0..1) for accepting a near-identical text as the same row. */
  fuzzyMatchThreshold?: number;
};

export type DedupeLineDiagnosticEntry = {
  fingerprint: string;
  /** Highest-confidence text kept as the representative reading for this row. */
  text: string;
  firstFrameIndex: number;
  lastFrameIndex: number;
  /** Number of OCR line-reads folded into this row (>= 1). */
  hitCount: number;
};

export type DedupeOcrLinesResult = {
  /** Deduped lines, ready for `parseDepositSlipHistoryText`. */
  lines: string[];
  /** Total OCR line-reads seen across all frames, before dedupe. */
  rawLineCount: number;
  /** Number of distinct rows after dedupe — `lines.length`. */
  uniqueLineCount: number;
  /** Parallel to `lines` (same order/count) — one entry per surviving row. */
  diagnostics: DedupeLineDiagnosticEntry[];
};

/** Default: 6 frames of continuity — generous for oversampled scroll footage
 * without being so wide it could bridge past a whole different row scrolling
 * through in between. Tune against the spike's example job. */
export const DEFAULT_FRAME_CONTINUITY_WINDOW = 6;

/** Default: 2% of frame height per band — a deposit-slip line is roughly
 * 5-10% of frame height (see fixture geometry notes in the plan), so this
 * gives a few bands of slack for scroll drift between adjacent frames. */
export const DEFAULT_Y_BAND_BUCKET = 0.02;

/** Default fuzzy floor for same-row OCR noise (single digit/character misread). */
export const LINE_FUZZY_MATCH_THRESHOLD = 0.88;

/**
 * Normalize OCR line text for fingerprinting. Deliberately conservative:
 * collapses whitespace/case and trims leading/trailing OCR junk, but keeps
 * interior digits/punctuation intact (timestamps, amounts, and colons/commas
 * are load-bearing content here, unlike free-text commander names).
 */
export function normalizeLineFingerprintText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[^a-z0-9]+$/, "");
}

type OpenRowCluster = {
  fingerprint: string;
  /** Representative text kept for output — the highest-confidence read so far. */
  bestText: string;
  bestConfidence: number;
  /** Normalized text of `bestText`, cached for fuzzy comparisons. */
  bestNormalized: string;
  /** Most recent normalized y-band (0..1), or null if this row has no geometry. */
  lastYBand: number | null;
  firstFrameIndex: number;
  lastFrameIndex: number;
  hitCount: number;
};

function yBand(
  line: FingerprintableOcrLine,
  frameHeight: number,
  bucketSize: number,
): number | null {
  if (!line.bbox || !Number.isFinite(frameHeight) || frameHeight <= 0) {
    return null;
  }
  const normalizedY0 = line.bbox.y0 / frameHeight;
  if (!Number.isFinite(normalizedY0)) return null;
  return Math.round(normalizedY0 / bucketSize) * bucketSize;
}

function findMatchingCluster(
  clusters: readonly OpenRowCluster[],
  candidateNormalized: string,
  candidateBand: number | null,
  bucketSize: number,
  fuzzyThreshold: number,
): OpenRowCluster | null {
  if (!candidateNormalized) return null;

  let best: OpenRowCluster | null = null;
  let bestScore = 0;

  for (const cluster of clusters) {
    // When both sides have geometry, require vertical proximity before even
    // considering text similarity — this is what makes fuzzy text matching
    // safe (two genuinely different rows are most likely not also stacked at
    // nearly the same on-screen position across adjacent frames).
    if (candidateBand != null && cluster.lastYBand != null) {
      const bandGap = Math.abs(candidateBand - cluster.lastYBand);
      if (bandGap > bucketSize * 1.5) continue;
    }

    if (candidateNormalized === cluster.bestNormalized) {
      return cluster;
    }

    const score = stringSimilarity(candidateNormalized, cluster.bestNormalized);
    if (score >= fuzzyThreshold && score > bestScore) {
      best = cluster;
      bestScore = score;
    }
  }

  return best;
}

/**
 * Dedupe OCR lines across an ordered sequence of frames into one flat,
 * frame-order-agnostic line list — see module doc for the algorithm.
 */
export function dedupeOcrLinesAcrossFrames(
  frames: readonly OcrFrameLines[],
  options?: DedupeOcrLinesOptions,
): DedupeOcrLinesResult {
  const continuityWindow =
    options?.frameContinuityWindow ?? DEFAULT_FRAME_CONTINUITY_WINDOW;
  const bucketSize = options?.yBandBucketSize ?? DEFAULT_Y_BAND_BUCKET;
  const fuzzyThreshold = options?.fuzzyMatchThreshold ?? LINE_FUZZY_MATCH_THRESHOLD;

  const orderedFrames = [...frames].sort((a, b) => a.frameIndex - b.frameIndex);

  let open: OpenRowCluster[] = [];
  const finalized: OpenRowCluster[] = [];
  let rawLineCount = 0;

  const expireStale = (currentFrameIndex: number): void => {
    const stillOpen: OpenRowCluster[] = [];
    for (const cluster of open) {
      if (currentFrameIndex - cluster.lastFrameIndex > continuityWindow) {
        finalized.push(cluster);
      } else {
        stillOpen.push(cluster);
      }
    }
    open = stillOpen;
  };

  for (const frame of orderedFrames) {
    expireStale(frame.frameIndex);

    for (const line of frame.lines) {
      const text = (line.text ?? "").trim();
      if (!text) continue;
      rawLineCount += 1;

      const normalized = normalizeLineFingerprintText(text);
      if (!normalized) continue;

      const band = yBand(line, frame.frameHeight, bucketSize);
      const match = findMatchingCluster(
        open,
        normalized,
        band,
        bucketSize,
        fuzzyThreshold,
      );

      if (match) {
        match.lastFrameIndex = frame.frameIndex;
        match.hitCount += 1;
        if (band != null) match.lastYBand = band;
        if (line.confidence > match.bestConfidence) {
          match.bestText = text;
          match.bestConfidence = line.confidence;
          match.bestNormalized = normalized;
        }
        continue;
      }

      open.push({
        fingerprint: normalized,
        bestText: text,
        bestConfidence: line.confidence,
        bestNormalized: normalized,
        lastYBand: band,
        firstFrameIndex: frame.frameIndex,
        lastFrameIndex: frame.frameIndex,
        hitCount: 1,
      });
    }
  }

  // Flush anything still open at the end of the job.
  finalized.push(...open);
  open = [];

  finalized.sort((a, b) => {
    if (a.firstFrameIndex !== b.firstFrameIndex) {
      return a.firstFrameIndex - b.firstFrameIndex;
    }
    const aBand = a.lastYBand ?? 0;
    const bBand = b.lastYBand ?? 0;
    return aBand - bBand;
  });

  return {
    lines: finalized.map((cluster) => cluster.bestText),
    rawLineCount,
    uniqueLineCount: finalized.length,
    diagnostics: finalized.map((cluster) => ({
      fingerprint: cluster.fingerprint,
      text: cluster.bestText,
      firstFrameIndex: cluster.firstFrameIndex,
      lastFrameIndex: cluster.lastFrameIndex,
      hitCount: cluster.hitCount,
    })),
  };
}
