/**
 * Chunked OCR for the deposit-slip `row_fingerprint_v1` shadow pass.
 *
 * Same motivation as primary `depositSlipOcrChunk`: native Tesseract at
 * concurrency 1 exceeds the video-process maxDuration (~300s) on long dense
 * extracts. Shadow jobs reuse primary frames but do not write per-frame
 * history onto `video_frames`, so progress + OCR lines accumulate in the
 * shadow job's `timingsJson` until the final chunk can fingerprint-dedupe.
 */

import type { OcrFrameLines } from "@/lib/banks/deposit-slip-ocr/row-fingerprint.shared";
import {
  DEFAULT_DEPOSIT_SLIP_OCR_FRAME_CHUNK_SIZE,
  depositSlipOcrChunkWindow,
  resolveDepositSlipOcrFrameChunkSize,
} from "@/lib/video/deposit-slip-ocr-chunks.shared";

export const DEPOSIT_SLIP_FINGERPRINT_SHADOW_CHUNK_KEY =
  "depositSlipFingerprintShadowChunk" as const;

export type DepositSlipFingerprintShadowChunkState = {
  version: 1;
  /** First frame index not yet OCR'd (0-based, contiguous). */
  nextFrameOffset: number;
  totalFrames: number;
  chunkSize: number;
  /** See {@link DepositSlipOcrChunkState.claimToken}. */
  claimToken?: string | null;
  /** OCR lines completed in prior chunks (instrumentation / resume). */
  frameLines: OcrFrameLines[];
  ocrFrameMs: number[];
};

export {
  DEFAULT_DEPOSIT_SLIP_OCR_FRAME_CHUNK_SIZE,
  depositSlipOcrChunkWindow,
  resolveDepositSlipOcrFrameChunkSize,
};

function isFingerprintBbox(
  value: unknown,
): value is { x0: number; y0: number; x1: number; y1: number } {
  if (value == null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.x0 === "number" &&
    typeof record.y0 === "number" &&
    typeof record.x1 === "number" &&
    typeof record.y1 === "number"
  );
}

function parseOcrFrameLines(value: unknown): OcrFrameLines | null {
  if (value == null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.frameIndex !== "number" ||
    !Number.isInteger(record.frameIndex) ||
    typeof record.frameHeight !== "number" ||
    !Number.isFinite(record.frameHeight) ||
    !Array.isArray(record.lines)
  ) {
    return null;
  }
  const lines: OcrFrameLines["lines"][number][] = [];
  for (const line of record.lines) {
    if (line == null || typeof line !== "object") return null;
    const lineRecord = line as Record<string, unknown>;
    if (
      typeof lineRecord.text !== "string" ||
      typeof lineRecord.confidence !== "number"
    ) {
      return null;
    }
    lines.push({
      text: lineRecord.text,
      confidence: lineRecord.confidence,
      bbox: isFingerprintBbox(lineRecord.bbox) ? lineRecord.bbox : null,
      rowHeight:
        typeof lineRecord.rowHeight === "number" ? lineRecord.rowHeight : null,
    });
  }
  return {
    frameIndex: record.frameIndex,
    frameHeight: record.frameHeight,
    lines,
  };
}

export function readDepositSlipFingerprintShadowChunkState(
  timingsJson: unknown,
): DepositSlipFingerprintShadowChunkState | null {
  if (timingsJson == null || typeof timingsJson !== "object") {
    return null;
  }
  const raw = (timingsJson as Record<string, unknown>)[
    DEPOSIT_SLIP_FINGERPRINT_SHADOW_CHUNK_KEY
  ];
  if (raw == null || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (record.version !== 1) {
    return null;
  }
  const nextFrameOffset = record.nextFrameOffset;
  const totalFrames = record.totalFrames;
  const chunkSize = record.chunkSize;
  const claimToken = record.claimToken;
  if (
    claimToken !== undefined &&
    claimToken !== null &&
    typeof claimToken !== "string"
  ) {
    return null;
  }
  if (
    typeof nextFrameOffset !== "number" ||
    !Number.isInteger(nextFrameOffset) ||
    nextFrameOffset < 0 ||
    typeof totalFrames !== "number" ||
    !Number.isInteger(totalFrames) ||
    totalFrames < 0 ||
    typeof chunkSize !== "number" ||
    !Number.isInteger(chunkSize) ||
    chunkSize < 1 ||
    !Array.isArray(record.frameLines) ||
    !Array.isArray(record.ocrFrameMs)
  ) {
    return null;
  }
  const frameLines: OcrFrameLines[] = [];
  for (const entry of record.frameLines) {
    const parsed = parseOcrFrameLines(entry);
    if (!parsed) return null;
    frameLines.push(parsed);
  }
  const ocrFrameMs: number[] = [];
  for (const ms of record.ocrFrameMs) {
    if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
    ocrFrameMs.push(ms);
  }
  return {
    version: 1,
    nextFrameOffset,
    totalFrames,
    chunkSize,
    claimToken:
      claimToken === undefined
        ? undefined
        : claimToken === null
          ? null
          : claimToken,
    frameLines,
    ocrFrameMs,
  };
}

export function writeDepositSlipFingerprintShadowChunkState(
  timingsJson: Record<string, unknown> | null | undefined,
  state: DepositSlipFingerprintShadowChunkState,
): Record<string, unknown> {
  return {
    ...(timingsJson ?? {}),
    [DEPOSIT_SLIP_FINGERPRINT_SHADOW_CHUNK_KEY]: state,
  };
}

export function clearDepositSlipFingerprintShadowChunkState(
  timingsJson: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const next = { ...(timingsJson ?? {}) };
  delete next[DEPOSIT_SLIP_FINGERPRINT_SHADOW_CHUNK_KEY];
  return next;
}

export function fingerprintShadowHasPersistedChunkState(
  state: DepositSlipFingerprintShadowChunkState | null,
): boolean {
  return state != null;
}

export function fingerprintShadowChunkNeedsMoreWork(
  state: DepositSlipFingerprintShadowChunkState | null,
): boolean {
  if (state == null) return false;
  return state.nextFrameOffset < state.totalFrames;
}
