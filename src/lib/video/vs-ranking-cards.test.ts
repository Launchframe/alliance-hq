import { describe, expect, it } from "vitest";

import {
  cleanVsRankingName,
  detectVsRankingCards,
  isVsRankingName,
  parseVsRankingScore,
  repairVsRankingScore,
  scoreHasExtraNarrowDigit,
} from "./vs-ranking-cards";

function fill(
  data: Buffer,
  channels: number,
  width: number,
  y0: number,
  y1: number,
  rgb: [number, number, number],
) {
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      if (channels > 3) data[i + 3] = 255;
    }
  }
}

describe("detectVsRankingCards", () => {
  it("finds colored cards on a light panel and skips the clipped row and footer", () => {
    const width = 200;
    const height = 500;
    const channels = 4;
    const data = Buffer.alloc(width * height * channels, 250);
    fill(data, channels, width, 120, 165, [180, 210, 230]);
    fill(data, channels, width, 185, 230, [240, 200, 60]);
    fill(data, channels, width, 250, 295, [140, 220, 150]);
    fill(data, channels, width, 310, 328, [180, 210, 230]);
    fill(data, channels, width, 450, 500, [30, 40, 60]);

    const cards = detectVsRankingCards(data, channels, width, height);
    expect(cards).toHaveLength(3);
    expect(cards.map((card) => card.y1 - card.y0)).toEqual([44, 44, 44]);
    expect(cards[0]!.y0).toBeGreaterThanOrEqual(118);
    expect(cards[0]!.y0).toBeLessThanOrEqual(124);
    expect(cards[2]!.y1).toBeLessThan(310);
  });
});

describe("cleanVsRankingName", () => {
  it("drops icon fragments and keeps short real name tokens", () => {
    expect(cleanVsRankingName("] bennyerl")).toBe("bennyerl");
    expect(cleanVsRankingName("{|| SPEEDBUMP69")).toBe("SPEEDBUMP69");
    expect(cleanVsRankingName("i SHADOW1405")).toBe("SHADOW1405");
    expect(cleanVsRankingName("5l 0ld379")).toBe("0ld379");
    expect(cleanVsRankingName("C Price")).toBe("C Price");
    expect(cleanVsRankingName("La Bdo")).toBe("La Bdo");
    expect(cleanVsRankingName("Ph City")).toBe("Ph City");
    expect(cleanVsRankingName("XxX RAVEN XxX")).toBe("XxX RAVEN XxX");
    expect(cleanVsRankingName("Mugiwaras69")).toBe("Mugiwaras69");
  });
});

describe("parseVsRankingScore", () => {
  it("accepts grouped points and rejects a clipped last group", () => {
    expect(parseVsRankingScore("51,111,666")).toBe("51111666");
    expect(parseVsRankingScore(". 10,979,960")).toBe("10979960");
    expect(parseVsRankingScore("5,826,597")).toBe("5826597");
    expect(parseVsRankingScore("0")).toBe("0");
    expect(parseVsRankingScore("24,404.61")).toBeNull();
    expect(parseVsRankingScore("5")).toBeNull();
    expect(parseVsRankingScore("1 19,979,478")).toBe("19979478");
    expect(parseVsRankingScore("5 29,018,181")).toBe("29018181");
  });

  it("puts back a trailing 1 only when the score ink still has that digit", () => {
    expect(repairVsRankingScore("24,404.61", { extraNarrowDigit: true })).toBe("24404611");
    expect(repairVsRankingScore("24,404,61", { extraNarrowDigit: true })).toBe("24404611");
    expect(repairVsRankingScore("24,404.61", { extraNarrowDigit: false })).toBeNull();
    expect(repairVsRankingScore("51,111,666", { extraNarrowDigit: false })).toBe("51111666");
    expect(repairVsRankingScore("5 29,018,181", { extraNarrowDigit: true })).toBe("29018181");
  });
});

describe("scoreHasExtraNarrowDigit", () => {
  it("notices one extra thin digit to the right of the recognized glyphs", () => {
    const width = 400;
    const height = 40;
    const data = Buffer.alloc(width * height * 4, 240);
    const paint = (x0: number, x1: number, y0: number, y1: number) => {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = (y * width + x) * 4;
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
          data[i + 3] = 255;
        }
      }
    };
    paint(270, 278, 8, 28);
    paint(282, 290, 8, 28);
    paint(294, 302, 8, 28);
    paint(306, 314, 8, 28);
    paint(318, 320, 22, 28);
    paint(324, 328, 8, 28);
    expect(scoreHasExtraNarrowDigit(data, 4, width, { y0: 4, y1: 36 }, 4)).toBe(true);
    expect(scoreHasExtraNarrowDigit(data, 4, width, { y0: 4, y1: 36 }, 5)).toBe(false);
  });
});

describe("isVsRankingName", () => {
  it("rejects column chrome and keeps digit-heavy commander names", () => {
    expect(isVsRankingName("Points")).toBe(false);
    expect(isVsRankingName("Your Alliance")).toBe(false);
    expect(isVsRankingName("0ld379")).toBe(true);
    expect(isVsRankingName("C Price")).toBe(true);
  });
});
