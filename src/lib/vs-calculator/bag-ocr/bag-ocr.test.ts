import { describe, expect, it } from "vitest";

import {
  bagCellBounds,
  bagCellCount,
  inferBagGridLayout,
} from "@/lib/vs-calculator/bag-ocr/bag-grid.shared";
import {
  hammingDistanceHex,
  ICON_PHASH_MATCH_THRESHOLD,
} from "@/lib/vs-calculator/icon-phash.shared";
import { matchIconPhash } from "@/lib/vs-calculator/bag-ocr/match-templates.shared";

describe("icon phash", () => {
  it("returns zero distance for identical hashes", () => {
    expect(hammingDistanceHex("0123456789abcdef", "0123456789abcdef")).toBe(0);
  });

  it("returns 64 when lengths differ", () => {
    expect(hammingDistanceHex("0123", "0123456789abcdef")).toBe(64);
  });

  it("matches within threshold", () => {
    const templates = [
      {
        slug: "drone_part",
        displayName: "Drone Part",
        iconPhash: "0123456789abcdef",
      },
    ];
    const result = matchIconPhash("0123456789abcdef", templates);
    expect(result?.slug).toBe("drone_part");
    expect(result!.confidence).toBeGreaterThan(0.5);
  });

  it("rejects when distance exceeds threshold", () => {
    const templates = [
      {
        slug: "drone_part",
        displayName: "Drone Part",
        iconPhash: "ffffffffffffffff",
      },
    ];
    const result = matchIconPhash("0000000000000000", templates);
    expect(result).toBeNull();
    expect(ICON_PHASH_MATCH_THRESHOLD).toBeLessThan(64);
  });
});

describe("bag grid layout", () => {
  it("infers square cells and positive cell count", () => {
    const layout = inferBagGridLayout(1080, 1920, 4);
    expect(layout.cols).toBe(4);
    expect(layout.rows).toBeGreaterThan(0);
    expect(bagCellCount(layout)).toBe(layout.cols * layout.rows);
  });

  it("produces non-overlapping cell bounds", () => {
    const layout = inferBagGridLayout(800, 1200, 4);
    const a = bagCellBounds(layout, 0);
    const b = bagCellBounds(layout, 1);
    expect(b.left).toBeGreaterThan(a.left);
  });
});
