import { describe, expect, it } from "vitest";

import {
  clearDepositSlipOcrChunkState,
  depositSlipOcrChunkWindow,
  readDepositSlipOcrChunkState,
  resolveDepositSlipOcrFrameChunkSize,
  resolveDepositSlipOcrOffsetFromFrames,
  resolveDepositSlipOcrResumeOffset,
  videoFrameHasDepositSlipHistory,
  writeDepositSlipOcrChunkState,
} from "@/lib/video/deposit-slip-ocr-chunks.shared";

describe("resolveDepositSlipOcrFrameChunkSize", () => {
  it("defaults when unset or invalid", () => {
    expect(resolveDepositSlipOcrFrameChunkSize(undefined)).toBe(25);
    expect(resolveDepositSlipOcrFrameChunkSize("")).toBe(25);
    expect(resolveDepositSlipOcrFrameChunkSize("0")).toBe(25);
    expect(resolveDepositSlipOcrFrameChunkSize("abc")).toBe(25);
  });

  it("parses and caps env overrides", () => {
    expect(resolveDepositSlipOcrFrameChunkSize("40")).toBe(40);
    expect(resolveDepositSlipOcrFrameChunkSize("999")).toBe(200);
  });
});

describe("depositSlipOcrChunkWindow", () => {
  it("slices mid and final windows", () => {
    expect(
      depositSlipOcrChunkWindow({
        nextFrameOffset: 0,
        totalFrames: 281,
        chunkSize: 25,
      }),
    ).toEqual({ start: 0, end: 25, frameCount: 25, isFinal: false });

    expect(
      depositSlipOcrChunkWindow({
        nextFrameOffset: 275,
        totalFrames: 281,
        chunkSize: 25,
      }),
    ).toEqual({ start: 275, end: 281, frameCount: 6, isFinal: true });
  });
});

describe("chunk state read/write", () => {
  it("round-trips and clears", () => {
    const written = writeDepositSlipOcrChunkState(
      { jobId: "j1" },
      {
        version: 1,
        nextFrameOffset: 50,
        totalFrames: 281,
        chunkSize: 25,
      },
    );
    expect(readDepositSlipOcrChunkState(written)).toEqual({
      version: 1,
      nextFrameOffset: 50,
      totalFrames: 281,
      chunkSize: 25,
    });
    expect(clearDepositSlipOcrChunkState(written)).toEqual({ jobId: "j1" });
  });

  it("rejects invalid shapes", () => {
    expect(readDepositSlipOcrChunkState(null)).toBeNull();
    expect(
      readDepositSlipOcrChunkState({
        depositSlipOcrChunk: { version: 2, nextFrameOffset: 0 },
      }),
    ).toBeNull();
  });
});

describe("resolveDepositSlipOcrOffsetFromFrames", () => {
  it("finds first frame without history", () => {
    expect(
      resolveDepositSlipOcrOffsetFromFrames([
        { frameIndex: 0, ocrRawJson: { history: { slips: [] } } },
        { frameIndex: 1, ocrRawJson: { history: { slips: [] } } },
        { frameIndex: 2, ocrRawJson: { lines: [] } },
      ]),
    ).toBe(2);
  });

  it("returns length when all complete", () => {
    expect(
      resolveDepositSlipOcrOffsetFromFrames([
        { frameIndex: 0, ocrRawJson: { history: { slips: [] } } },
        { frameIndex: 1, ocrRawJson: { history: { slips: [] } } },
      ]),
    ).toBe(2);
  });
});

describe("resolveDepositSlipOcrResumeOffset", () => {
  const frames = [
    { frameIndex: 0, ocrRawJson: { history: { slips: [] } } },
    { frameIndex: 1, ocrRawJson: { history: { slips: [] } } },
    { frameIndex: 2, ocrRawJson: { lines: [] } },
    { frameIndex: 3, ocrRawJson: null },
  ];

  it("uses frame scan when no stored cursor", () => {
    expect(
      resolveDepositSlipOcrResumeOffset({ storedState: null, frames }),
    ).toBe(2);
  });

  it("does not skip frames still missing history when cursor is ahead", () => {
    expect(
      resolveDepositSlipOcrResumeOffset({
        storedState: {
          version: 1,
          nextFrameOffset: 4,
          totalFrames: 4,
          chunkSize: 2,
        },
        frames,
      }),
    ).toBe(2);
  });

  it("re-OCRs from the cursor when frames are ahead (mid-chunk rewrite)", () => {
    expect(
      resolveDepositSlipOcrResumeOffset({
        storedState: {
          version: 1,
          nextFrameOffset: 2,
          totalFrames: 4,
          chunkSize: 2,
        },
        frames: [
          { frameIndex: 0, ocrRawJson: { history: { slips: [] } } },
          { frameIndex: 1, ocrRawJson: { history: { slips: [] } } },
          { frameIndex: 2, ocrRawJson: { history: { slips: [] } } },
          { frameIndex: 3, ocrRawJson: { history: { slips: [] } } },
        ],
      }),
    ).toBe(2);
  });
});

describe("videoFrameHasDepositSlipHistory", () => {
  it("requires a history object", () => {
    expect(videoFrameHasDepositSlipHistory({ lines: [] })).toBe(false);
    expect(videoFrameHasDepositSlipHistory({ history: { slips: [] } })).toBe(
      true,
    );
  });
});
