import { beforeEach, describe, expect, it, vi } from "vitest";

const { runTesseract } = vi.hoisted(() => ({ runTesseract: vi.fn() }));
vi.mock("@/lib/members/roster-ocr/tesseract", () => ({ runTesseract }));
vi.mock("sharp", () => ({
  default: () => {
    const image = {
      rotate: () => image,
      resize: () => image,
      grayscale: () => image,
      normalize: () => image,
      png: () => image,
      toBuffer: async () => Buffer.from("processed"),
    };
    return image;
  },
}));

import { ocrVsNativeFrames, parseVsScoreLines } from "./ocr-vs-native";

const lines = (...text: string[]) => text.map((text) => ({ text, confidence: 90 }));

beforeEach(() => vi.clearAllMocks());

describe("parseVsScoreLines", () => {
  it("extracts ranked scores, preserving names and exact integer scores", () => {
    expect(parseVsScoreLines(lines(
      "Alliance Duel", "Rank Commander Points", "1 [HQ] Alpha 123,456,789",
      "2 Commander 42 98.765.432", "3 Zero Hero 0", "Weekly Total 999,999,999",
    ))).toEqual([
      { rank: 1, name: "[HQ] Alpha", score: "123456789" },
      { rank: 2, name: "Commander 42", score: "98765432" },
      { rank: 3, name: "Zero Hero", score: "0" },
    ]);
  });

  it("keeps medal rows without OCR rank text and ignores total labels", () => {
    expect(parseVsScoreLines(lines(
      "Alpha 123,456,789", "2. Beta 98,765,432", "My Points 123,456,789",
      "Total 999,999,999", "Pontuação 999.999.999",
    ))).toEqual([
      { name: "Alpha", score: "123456789" },
      { rank: 2, name: "Beta", score: "98765432" },
    ]);
  });

  it("rejects incomplete rows, invalid ranks, fractional and abbreviated scores", () => {
    expect(parseVsScoreLines(lines(
      "1 Alpha", "0 Alpha 10,000", "201 Alpha 10,000", "4 Alpha 12.3M",
      "5 Alpha 12,34", "6 Alpha -123", "7 Alpha 1.5", "8 12345",
    ))).toEqual([]);
  });

  it("joins horizontally separated OCR columns only when their vertical boxes overlap", () => {
    expect(parseVsScoreLines([
      { text: "4", confidence: 90, bbox: { x0: 5, y0: 100, x1: 15, y1: 120 } },
      { text: "Alpha", confidence: 90, bbox: { x0: 50, y0: 100, x1: 100, y1: 120 } },
      { text: "1,234,567", confidence: 90, bbox: { x0: 200, y0: 100, x1: 300, y1: 120 } },
      { text: "Unrelated", confidence: 90, bbox: { x0: 50, y0: 140, x1: 100, y1: 160 } },
    ])).toEqual([{ rank: 4, name: "Alpha", score: "1234567" }]);
  });
});

describe("ocrVsNativeFrames", () => {
  it("runs real OCR per frame, retains source indices and awaits progress", async () => {
    runTesseract.mockResolvedValue(lines("1 Alpha 1,234,567"));
    const onProgress = vi.fn().mockResolvedValue(undefined);
    const result = await ocrVsNativeFrames([
      { index: 2, buffer: Buffer.from("first") },
      { index: 8, buffer: Buffer.from("second") },
    ], { onProgress });
    expect(runTesseract).toHaveBeenCalledTimes(2);
    expect(result.entries).toEqual([
      { rank: 1, name: "Alpha", score: "1234567", _sourceFrameIndex: 2 },
      { rank: 1, name: "Alpha", score: "1234567", _sourceFrameIndex: 8 },
    ]);
    expect(result.concurrency).toBe(1);
    expect(result.frameTimings[0]).toMatchObject({ frameIndex: 2, entryCount: 1, uploadMs: 0, error: null });
    expect(onProgress.mock.calls).toEqual([[1, 2], [2, 2]]);
  });

  it("propagates OCR failures instead of silently returning mock scores", async () => {
    runTesseract.mockRejectedValue(new Error("OCR frame failed"));
    await expect(ocrVsNativeFrames([{ index: 0, buffer: Buffer.from("frame") }]))
      .rejects.toThrow("OCR frame failed");
  });
});
