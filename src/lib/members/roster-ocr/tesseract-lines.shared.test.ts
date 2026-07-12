import { describe, expect, it } from "vitest";

import { extractOcrLinesFromTesseractData } from "@/lib/members/roster-ocr/tesseract-lines.shared";

describe("extractOcrLinesFromTesseractData", () => {
  it("reads nested block/paragraph lines and applies confidence filter", () => {
    const lines = extractOcrLinesFromTesseractData(
      {
        blocks: [
          {
            paragraphs: [
              {
                lines: [
                  { text: "keep me", confidence: 80 },
                  { text: "drop me", confidence: 10 },
                  { text: "  ", confidence: 99 },
                ],
              },
            ],
          },
        ],
        text: "ignored when blocks exist",
      },
      40,
    );
    expect(lines).toEqual([{ text: "keep me", confidence: 80 }]);
  });

  it("falls back to splitting data.text when blocks are null (tesseract.js v7 default)", () => {
    const lines = extractOcrLinesFromTesseractData(
      {
        blocks: null,
        text: "Deposit: CrystalGold x 1,000\nTerm: 8 day\n",
      },
      40,
    );
    expect(lines).toEqual([
      { text: "Deposit: CrystalGold x 1,000", confidence: 100 },
      { text: "Term: 8 day", confidence: 100 },
    ]);
  });

  it("returns empty when neither blocks nor text have content", () => {
    expect(extractOcrLinesFromTesseractData({ blocks: null, text: "" }, 40)).toEqual(
      [],
    );
  });
});
