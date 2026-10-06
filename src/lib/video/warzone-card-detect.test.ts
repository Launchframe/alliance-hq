import { describe, expect, it } from "vitest";

import { detectCardBands } from "@/lib/video/warzone-card-detect";

const WIDTH = 400;
const HEIGHT = 600;

/**
 * Dark list background with light card bands separated by uniform
 * brighter separator rows — the poll/leaderboard card structure.
 */
function renderCards(
  bands: Array<{ y0: number; y1: number; lum?: number }>,
): Buffer {
  const data = Buffer.alloc(WIDTH * HEIGHT * 3, 60);
  const fill = (x: number, y: number, lum: number) => {
    const i = (y * WIDTH + x) * 3;
    data[i] = data[i + 1] = data[i + 2] = lum;
  };
  for (const band of bands) {
    for (let y = band.y0; y < band.y1; y++) {
      for (let x = 8; x < WIDTH - 8; x++) fill(x, y, band.lum ?? 213);
      // Two text-like rows: dark glyphs on part of the card, so the
      // scanline median stays on the fill but stddev is high.
      if (y === band.y0 + 8 || y === band.y1 - 8) {
        for (let x = 40; x < 160; x++) fill(x, y, 20);
      }
    }
    // Bright uniform separator directly below each card.
    for (let y = band.y1; y < Math.min(band.y1 + 6, HEIGHT); y++) {
      for (let x = 0; x < WIDTH; x++) fill(x, y, 245);
    }
  }
  return data;
}

describe("detectCardBands", () => {
  it("detects light cards on a dark background and splits on separators", () => {
    const data = renderCards([
      { y0: 60, y1: 100 },
      { y0: 140, y1: 180 },
      { y0: 220, y1: 260 },
    ]);
    const cards = detectCardBands(data, 3, WIDTH, HEIGHT, {
      x0: 0,
      y0: 0,
      x1: WIDTH,
      y1: HEIGHT,
    });
    expect(cards).toHaveLength(3);
    expect(cards[0]!.y0).toBe(60);
    expect(cards[1]!.y0).toBe(140);
    expect(cards[2]!.y0).toBe(220);
  });

  it("excludes cards clipped by the scan bounds", () => {
    const data = renderCards([
      { y0: 0, y1: 40 },
      { y0: 80, y1: 120 },
    ]);
    const cards = detectCardBands(data, 3, WIDTH, HEIGHT, {
      x0: 0,
      y0: 0,
      x1: WIDTH,
      y1: HEIGHT,
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]!.y0).toBe(80);
  });

  it("returns no cards when nothing approaches card luminance", () => {
    const data = Buffer.alloc(WIDTH * HEIGHT * 3, 40);
    expect(
      detectCardBands(data, 3, WIDTH, HEIGHT, {
        x0: 0,
        y0: 0,
        x1: WIDTH,
        y1: HEIGHT,
      }),
    ).toHaveLength(0);
  });
});
