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
    expect(lines).toEqual([
      { text: "keep me", confidence: 80, bbox: null, rowHeight: null },
    ]);
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
      {
        text: "Deposit: CrystalGold x 1,000",
        confidence: 100,
        bbox: null,
        rowHeight: null,
      },
      { text: "Term: 8 day", confidence: 100, bbox: null, rowHeight: null },
    ]);
  });

  it("returns empty when neither blocks nor text have content", () => {
    expect(extractOcrLinesFromTesseractData({ blocks: null, text: "" }, 40)).toEqual(
      [],
    );
  });

  it("passes through line bbox and derives rowHeight when Tesseract returns line geometry", () => {
    const lines = extractOcrLinesFromTesseractData(
      {
        blocks: [
          {
            paragraphs: [
              {
                lines: [
                  {
                    text: "with geometry",
                    confidence: 80,
                    bbox: { x0: 10, y0: 100, x1: 300, y1: 140 },
                  },
                ],
              },
            ],
          },
        ],
      },
      40,
    );
    expect(lines).toEqual([
      {
        text: "with geometry",
        confidence: 80,
        bbox: { x0: 10, y0: 100, x1: 300, y1: 140 },
        rowHeight: 40,
      },
    ]);
  });

  it("falls back to null bbox/rowHeight when Tesseract returns a malformed line bbox", () => {
    const lines = extractOcrLinesFromTesseractData(
      {
        blocks: [
          {
            paragraphs: [
              {
                lines: [
                  {
                    text: "bad geometry",
                    confidence: 80,
                    bbox: { x0: 10, y0: Number.NaN, x1: 300, y1: 140 },
                  },
                ],
              },
            ],
          },
        ],
      },
      40,
    );
    expect(lines).toEqual([
      { text: "bad geometry", confidence: 80, bbox: null, rowHeight: null },
    ]);
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
        bbox: null,
        rowHeight: null,
      },
    ]);
  });

  it("carries both word spans and the line bbox when Tesseract returns full geometry", () => {
    const lines = extractOcrLinesFromTesseractData(
      {
        blocks: [
          {
            paragraphs: [
              {
                lines: [
                  {
                    text: "600.00K 500.00K",
                    confidence: 90,
                    bbox: { x0: 10, y0: 200, x1: 390, y1: 236 },
                    words: [
                      { text: "600.00K", bbox: { x0: 10, x1: 90 } },
                      { text: "500.00K", bbox: { x0: 310, x1: 390 } },
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
        text: "600.00K 500.00K",
        confidence: 90,
        words: [
          { text: "600.00K", charStart: 0, charEnd: 7, x0: 10, x1: 90 },
          { text: "500.00K", charStart: 8, charEnd: 15, x0: 310, x1: 390 },
        ],
        bbox: { x0: 10, y0: 200, x1: 390, y1: 236 },
        rowHeight: 36,
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
    expect(lines).toEqual([
      { text: "keep me", confidence: 90, bbox: null, rowHeight: null },
    ]);
  });

  it("falls back to the full line.text when only SOME words are missing bbox, instead of silently dropping those words' text", () => {
    const lines = extractOcrLinesFromTesseractData(
      {
        blocks: [
          {
            paragraphs: [
              {
                lines: [
                  {
                    text: "Commander Nightfall",
                    confidence: 90,
                    words: [
                      { text: "Commander", bbox: { x0: 10, x1: 90 } },
                      { text: "Nightfall", bbox: null },
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
      { text: "Commander Nightfall", confidence: 90, bbox: null, rowHeight: null },
    ]);
  });

  it("falls back to line.text when a word bbox coordinate is NaN (never emits non-finite x positions)", () => {
    const lines = extractOcrLinesFromTesseractData(
      {
        blocks: [
          {
            paragraphs: [
              {
                lines: [
                  {
                    text: "600.00K 500.00K",
                    confidence: 90,
                    words: [
                      { text: "600.00K", bbox: { x0: 10, x1: 90 } },
                      { text: "500.00K", bbox: { x0: Number.NaN, x1: 390 } },
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
      { text: "600.00K 500.00K", confidence: 90, bbox: null, rowHeight: null },
    ]);
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
        bbox: null,
        rowHeight: null,
      },
    ]);
  });
});
