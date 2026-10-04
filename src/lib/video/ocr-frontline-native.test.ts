import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import type { OcrLineResult } from "@/lib/members/roster-ocr/tesseract";

const { recognize } = vi.hoisted(() => ({ recognize: vi.fn() }));
vi.mock("@/lib/members/roster-ocr/tesseract", () => ({ runTesseract: recognize }));

import { frontlineAllianceTabAnchor, ocrFrontlineNativeFrames, parseFrontlineImage } from "./ocr-frontline-native";

const headers: OcrLineResult[] = [
  { text: "RANKING", confidence: 95, bbox: { x0: 500, x1: 750, y0: 40, y1: 107 } },
  { text: "Alliance", confidence: 95, bbox: { x0: 147, x1: 320, y0: 202, y1: 242 } },
  { text: "Warzone", confidence: 95, bbox: { x0: 537, x1: 720, y0: 206, y1: 235 } },
  { text: "Master Leaderboard", confidence: 95, bbox: { x0: 852, x1: 1197, y0: 209, y1: 234 } },
];

async function tabImage(selected: number | null): Promise<Buffer> {
  const tabs = [0, 1, 2].map((index) => `<rect x="${index * 420}" y="160" width="420" height="100" fill="${index === selected ? "#eeeeee" : "#555555"}"/>`).join("");
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1260" height="3100"><rect width="1260" height="3100" fill="white"/>${tabs}</svg>`)).png().toBuffer();
}

beforeEach(() => { recognize.mockReset(); });

describe("Frontline selected-tab pixel evidence", () => {
  it("requires the Alliance tab to be highlighted rather than merely visible", async () => {
    expect(await frontlineAllianceTabAnchor(await tabImage(0), headers, 1260)).not.toBeNull();
    for (const selected of [1, 2, null]) {
      expect(await frontlineAllianceTabAnchor(await tabImage(selected), headers, 1260)).toBeNull();
    }
  });

  it("rejects missing ranking/header evidence", async () => {
    expect(await frontlineAllianceTabAnchor(await tabImage(0), headers.slice(1), 1260)).toBeNull();
    recognize.mockResolvedValue([]);
    expect(await frontlineAllianceTabAnchor(await tabImage(0), headers.filter((line) => line.text !== "Alliance"), 1260)).toBeNull();
  });
});

describe("Frontline row geometry", () => {
  const line = (text: string, x0: number, x1: number, y0: number, y1: number): OcrLineResult => ({
    text, confidence: 95, bbox: { x0, x1, y0, y1 },
    words: [{ text, charStart: 0, charEnd: text.length, x0, x1 }],
  });

  it("pairs two-line scores locally and retains missing stage without substituting five", async () => {
    recognize.mockResolvedValue([]).mockResolvedValueOnce([
      ...headers,
      line("Stage ?", 1023, 1191, 1140, 1183),
      line("왕족발 Bossam2", 372, 800, 1170, 1215),
      line("x2501", 990, 1191, 1195, 1255),
      line("Stage 8", 1023, 1191, 1351, 1394),
      line("Alpha", 372, 800, 1381, 1426),
      line("x0", 990, 1191, 1406, 1466),
      line("Stage 9", 1023, 1191, 3050, 3090),
      line("Clipped", 372, 800, 3070, 3099),
    ]);
    const result = await parseFrontlineImage(await tabImage(0));
    expect(result.entries).toEqual([
      { name: "왕족발 Bossam2", score: "2501", frontlineStage: null },
      { name: "Alpha", score: "0", frontlineStage: 8 },
    ]);
  });

  it("drops other-tab frames and preserves source index, timing and progress for accepted rows", async () => {
    recognize.mockResolvedValue([]).mockResolvedValueOnce(headers).mockResolvedValueOnce([
      ...headers,
      line("Stage 6", 1023, 1191, 1140, 1183),
      line("Alpha", 372, 800, 1170, 1215),
      line("x42", 990, 1191, 1195, 1255),
    ]);
    const onProgress = vi.fn();
    const result = await ocrFrontlineNativeFrames([
      { index: 2, buffer: await tabImage(1) },
      { index: 7, buffer: await tabImage(0) },
    ], { onProgress });
    expect(result.entries).toEqual([{ name: "Alpha", score: "42", frontlineStage: 6, _sourceFrameIndex: 7 }]);
    expect(result.observations).toEqual(result.entries);
    expect(result.frameTimings.map((timing) => timing.entryCount)).toEqual([0, 1]);
    expect(onProgress.mock.calls).toEqual([[1, 2], [2, 2]]);
  });
});
