import { describe, expect, it } from "vitest";

import {
  dedupeOcrLinesAcrossFrames,
  normalizeLineFingerprintText,
  type OcrFrameLines,
} from "@/lib/banks/deposit-slip-ocr/row-fingerprint.shared";

const FRAME_HEIGHT = 1000;

function line(
  text: string,
  y0: number,
  confidence = 90,
): { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } } {
  return {
    text,
    confidence,
    bbox: { x0: 10, y0, x1: 400, y1: y0 + 40 },
  };
}

function frame(frameIndex: number, lines: ReturnType<typeof line>[]): OcrFrameLines {
  return { frameIndex, lines, frameHeight: FRAME_HEIGHT };
}

describe("normalizeLineFingerprintText", () => {
  it("collapses whitespace/case and trims leading/trailing junk", () => {
    expect(normalizeLineFingerprintText("  [BigD]Trailblazer   ")).toBe(
      "bigd]trailblazer",
    );
    expect(normalizeLineFingerprintText("Deposited: 5,000 CG")).toBe(
      "deposited: 5,000 cg",
    );
  });

  it("keeps interior digits and punctuation intact", () => {
    expect(normalizeLineFingerprintText("07-16 13:18")).toBe("07-16 13:18");
  });
});

describe("dedupeOcrLinesAcrossFrames", () => {
  it("collapses the same row repeated across several consecutive overlapping frames", () => {
    const frames: OcrFrameLines[] = [
      frame(0, [line("Commander Alpha  07-16 13:18", 200)]),
      frame(1, [line("Commander Alpha 07-16 13:18", 202)]),
      frame(2, [line("Commander Alpha 07-16 13:18", 204)]),
      frame(3, [line("Commander Alpha 07-16 13:18", 206)]),
    ];

    const result = dedupeOcrLinesAcrossFrames(frames);

    expect(result.rawLineCount).toBe(4);
    expect(result.uniqueLineCount).toBe(1);
    expect(result.lines).toEqual(["Commander Alpha  07-16 13:18"]);
    expect(result.diagnostics[0]).toMatchObject({
      firstFrameIndex: 0,
      lastFrameIndex: 3,
      hitCount: 4,
    });
  });

  it("keeps a same-text row separate when it reappears after the continuity window has expired (post-loot re-deposit)", () => {
    const frames: OcrFrameLines[] = [
      frame(0, [line("Commander Bravo 5,000 CG 3d", 300)]),
      frame(1, [line("Commander Bravo 5,000 CG 3d", 300)]),
      // Row scrolls off; other rows occupy the frames in between, well beyond
      // the default continuity window (6 frames).
      frame(10, [line("Commander Charlie 1,000 CG 1d", 300)]),
      // Commander Bravo is looted and immediately re-deposits: same text,
      // same visual position, but far outside the continuity window.
      frame(20, [line("Commander Bravo 5,000 CG 3d", 300)]),
      frame(21, [line("Commander Bravo 5,000 CG 3d", 300)]),
    ];

    const result = dedupeOcrLinesAcrossFrames(frames);

    const bravoRows = result.diagnostics.filter((d) =>
      d.text.includes("Commander Bravo"),
    );
    expect(bravoRows).toHaveLength(2);
    expect(bravoRows[0]).toMatchObject({ firstFrameIndex: 0, lastFrameIndex: 1, hitCount: 2 });
    expect(bravoRows[1]).toMatchObject({ firstFrameIndex: 20, lastFrameIndex: 21, hitCount: 2 });
    expect(result.uniqueLineCount).toBe(3);
  });

  it("collapses OCR noise (single differing character/digit) on the same physical row", () => {
    const frames: OcrFrameLines[] = [
      frame(0, [line("Commander Delta 07-16 13:18", 500, 60)]),
      // OCR misreads one digit on the next overlapping frame, same position.
      frame(1, [line("Commander Delta 07-16 13:16", 502, 55)]),
      frame(2, [line("Commander Delta 07-16 13:18", 504, 91)]),
    ];

    const result = dedupeOcrLinesAcrossFrames(frames);

    expect(result.uniqueLineCount).toBe(1);
    expect(result.rawLineCount).toBe(3);
    // The highest-confidence reading is kept as the representative text.
    expect(result.lines).toEqual(["Commander Delta 07-16 13:18"]);
    expect(result.diagnostics[0]?.hitCount).toBe(3);
  });

  it("keeps genuinely different rows at similar y in non-adjacent frames separate", () => {
    const frames: OcrFrameLines[] = [
      frame(0, [line("Commander Echo 2,000 CG 1d", 400)]),
      frame(1, [line("Commander Foxtrot 9,000 CG 5d", 400)]),
    ];

    const result = dedupeOcrLinesAcrossFrames(frames);

    expect(result.uniqueLineCount).toBe(2);
    expect(result.lines).toContain("Commander Echo 2,000 CG 1d");
    expect(result.lines).toContain("Commander Foxtrot 9,000 CG 5d");
  });

  it("falls back to text-only matching (no y-gate) when lines carry no bbox", () => {
    const frames: OcrFrameLines[] = [
      { frameIndex: 0, lines: [{ text: "Commander Golf 1,500 CG 3d", confidence: 88 }], frameHeight: FRAME_HEIGHT },
      { frameIndex: 1, lines: [{ text: "Commander Golf 1,500 CG 3d", confidence: 92 }], frameHeight: FRAME_HEIGHT },
    ];

    const result = dedupeOcrLinesAcrossFrames(frames);

    expect(result.uniqueLineCount).toBe(1);
    expect(result.diagnostics[0]?.hitCount).toBe(2);
  });

  it("orders deduped lines by first-seen frame index, then y-position within a frame", () => {
    const frames: OcrFrameLines[] = [
      frame(0, [
        line("Commander Hotel", 100),
        line("Commander India", 300),
      ]),
      // A brand-new row appears on a later frame (scrolled into view). Even
      // though its y-position is above Hotel's, it was first seen later, so
      // it sorts after both — first-seen frame index wins over raw position.
      frame(5, [line("Commander Juliet", 50)]),
    ];

    const result = dedupeOcrLinesAcrossFrames(frames);

    expect(result.lines).toEqual([
      "Commander Hotel",
      "Commander India",
      "Commander Juliet",
    ]);
  });

  it("returns empty output for an empty frame set", () => {
    const result = dedupeOcrLinesAcrossFrames([]);
    expect(result).toEqual({
      lines: [],
      rawLineCount: 0,
      uniqueLineCount: 0,
      diagnostics: [],
    });
  });
});
