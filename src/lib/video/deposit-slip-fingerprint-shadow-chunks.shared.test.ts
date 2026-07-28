import { describe, expect, it } from "vitest";

import {
  DEPOSIT_SLIP_FINGERPRINT_SHADOW_CHUNK_KEY,
  clearDepositSlipFingerprintShadowChunkState,
  fingerprintShadowChunkNeedsMoreWork,
  fingerprintShadowHasPersistedChunkState,
  readDepositSlipFingerprintShadowChunkState,
  writeDepositSlipFingerprintShadowChunkState,
} from "@/lib/video/deposit-slip-fingerprint-shadow-chunks.shared";

describe("deposit-slip fingerprint shadow chunk state", () => {
  const sampleState = {
    version: 1 as const,
    nextFrameOffset: 25,
    totalFrames: 90,
    chunkSize: 25,
    frameLines: [
      {
        frameIndex: 0,
        frameHeight: 100,
        lines: [
          {
            text: "Alice 100",
            confidence: 90,
            bbox: { x0: 1, y0: 2, x1: 3, y1: 4 },
            rowHeight: 10,
          },
        ],
      },
    ],
    ocrFrameMs: [12, 14],
  };

  it("round-trips chunk state through timingsJson", () => {
    const written = writeDepositSlipFingerprintShadowChunkState(
      { totalMs: 1 },
      sampleState,
    );
    expect(written.totalMs).toBe(1);
    expect(readDepositSlipFingerprintShadowChunkState(written)).toEqual(
      sampleState,
    );
  });

  it("clears chunk state", () => {
    const written = writeDepositSlipFingerprintShadowChunkState({}, sampleState);
    const cleared = clearDepositSlipFingerprintShadowChunkState(written);
    expect(cleared[DEPOSIT_SLIP_FINGERPRINT_SHADOW_CHUNK_KEY]).toBeUndefined();
    expect(readDepositSlipFingerprintShadowChunkState(cleared)).toBeNull();
  });

  it("rejects malformed frame lines", () => {
    expect(
      readDepositSlipFingerprintShadowChunkState({
        [DEPOSIT_SLIP_FINGERPRINT_SHADOW_CHUNK_KEY]: {
          ...sampleState,
          frameLines: [{ frameIndex: 0 }],
        },
      }),
    ).toBeNull();
  });

  it("detects incomplete chunk work", () => {
    expect(fingerprintShadowChunkNeedsMoreWork(null)).toBe(false);
    expect(fingerprintShadowChunkNeedsMoreWork(sampleState)).toBe(true);
    expect(
      fingerprintShadowChunkNeedsMoreWork({
        ...sampleState,
        nextFrameOffset: 90,
      }),
    ).toBe(false);
  });

  it("detects persisted chunk state for continuation", () => {
    expect(fingerprintShadowHasPersistedChunkState(null)).toBe(false);
    expect(fingerprintShadowHasPersistedChunkState(sampleState)).toBe(true);
    expect(
      fingerprintShadowHasPersistedChunkState({
        ...sampleState,
        nextFrameOffset: 90,
      }),
    ).toBe(true);
  });
});
