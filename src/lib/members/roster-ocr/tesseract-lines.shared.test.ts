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

  it("rebuilds line text from words and records each word's char range + bbox x0/x1", () => {
    const lines = extractOcrLinesFromTesseractData(
      {
        blocks: [
          {
            paragraphs: [
              {
                lines: [
                  {
                    text: "600.00K   600.00K", // tesseract's own spacing is ignored
                    confidence: 90,
                    words: [
                      { text: "600.00K", bbox: { x0: 10, x1: 90 } },
                      { text: "600.00K", bbox: { x0: 310, x1: 390 } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
        text: "",
      },
      40,
    );
    expect(lines).toEqual([
      {
        text: "600.00K 600.00K",
        confidence: 90,
        words: [
          { text: "600.00K", charStart: 0, charEnd: 7, x0: 10, x1: 90 },
          { text: "600.00K", charStart: 8, charEnd: 15, x0: 310, x1: 390 },
        ],
      },
    ]);
  });

  it("falls back to line.text and omits words when a word is missing bbox coordinates", () => {
    const lines = extractOcrLinesFromTesseractData(
      {
        blocks: [
          {
            paragraphs: [
              {
                lines: [
                  {
                    text: "keep me",
                    confidence: 90,
                    words: [{ text: "keep me", bbox: null }],
                  },
                ],
              },
            ],
          },
        ],
        text: "",
      },
      40,
    );
    expect(lines).toEqual([{ text: "keep me", confidence: 90 }]);
  });

  it("skips blank words when reconstructing text and offsets", () => {
    const lines = extractOcrLinesFromTesseractData(
      {
        blocks: [
          {
            paragraphs: [
              {
                lines: [
                  {
                    text: "unused",
                    confidence: 90,
                    words: [
                      { text: "  ", bbox: { x0: 0, x1: 5 } },
                      { text: "Lv.3", bbox: { x0: 100, x1: 150 } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
        text: "",
      },
      40,
    );
    expect(lines).toEqual([
      {
        text: "Lv.3",
        confidence: 90,
        words: [{ text: "Lv.3", charStart: 0, charEnd: 4, x0: 100, x1: 150 }],
      },
    ]);
  });
});
