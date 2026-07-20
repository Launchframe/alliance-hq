import { describe, expect, it } from "vitest";

import {
  assembleGeometryParse,
  coalesceLabelLines,
  normalizeDigitsOnlyComponent,
  normalizeGeometryLines,
  parseDigitsOnlyComponent,
  parseDigitsOnlyHeaderTotal,
  zipLabelsToValues,
} from "@/lib/thp/hero-power-ocr/parse-power-details-geometry.shared";
import { sumThpBreakdown } from "@/lib/thp/breakdown.shared";
import type { ThpBreakdown } from "@/lib/thp/my-thp.shared";

/**
 * Simulated digits-only OCR for the Jul 20 screenshot
 * (`164,615,505` family). Commas are absent — as if Tesseract ran with
 * whitelist `0123456789`.
 */
const JUL20_EXPECTED = {
  heroPowerTotal: 164_615_505,
  breakdown: {
    heroLevel: 85_868_520,
    decorationsAndBuildings: 37_811_658,
    gear: 13_190_850,
    exclusiveWeapons: 9_408_080,
    heroTier: 7_051_707,
    heroSkill: 6_581_990,
    wallOfHonor: 4_702_700,
  } satisfies ThpBreakdown,
};

describe("parseDigitsOnlyValue", () => {
  it("accepts contiguous digit strings from digits-only OCR", () => {
    expect(parseDigitsOnlyHeaderTotal("164615505")).toBe(164_615_505);
    expect(parseDigitsOnlyComponent("85868520")).toBe(85_868_520);
  });

  it("rejects 12-digit freeform comma→digit blobs", () => {
    expect(parseDigitsOnlyHeaderTotal("164376153505")).toBeNull();
  });

  it("normalizeDigitsOnlyComponent undoes separator-slot pollution only", () => {
    expect(normalizeDigitsOnlyComponent("858681520")).toBe(85_868_520);
    expect(normalizeDigitsOnlyComponent("378111658")).toBe(37_811_658);
    expect(normalizeDigitsOnlyComponent("3718117658")).toBe(37_811_658);
    expect(normalizeDigitsOnlyComponent("974081080")).toBe(9_408_080);
    expect(normalizeDigitsOnlyComponent("17051707")).toBe(7_051_707);
    expect(normalizeDigitsOnlyComponent("65811990")).toBe(6_581_990);
  });
});

describe("zipLabelsToValues + assembleGeometryParse", () => {
  it("pairs Jul 20 layout by yNorm and completes when sum matches header", () => {
    const cropHeight = 1000;
    const labels = coalesceLabelLines(
      normalizeGeometryLines(
        [
          { text: "Hero Power", bbox: { x0: 0, y0: 40, x1: 200, y1: 80 } },
          { text: "Hero Level", bbox: { x0: 0, y0: 120, x1: 200, y1: 160 } },
          {
            text: "Decorations & Building",
            bbox: { x0: 0, y0: 200, x1: 280, y1: 230 },
          },
          { text: "Stats", bbox: { x0: 0, y0: 230, x1: 80, y1: 255 } },
          { text: "Gear", bbox: { x0: 0, y0: 280, x1: 100, y1: 320 } },
          {
            text: "Exclusive Weapon",
            bbox: { x0: 0, y0: 360, x1: 220, y1: 400 },
          },
          { text: "Hero Tier", bbox: { x0: 0, y0: 440, x1: 180, y1: 480 } },
          { text: "Hero Skill", bbox: { x0: 0, y0: 520, x1: 180, y1: 560 } },
          {
            text: "Wall of Honor",
            bbox: { x0: 0, y0: 600, x1: 200, y1: 640 },
          },
          { text: "Drone Power", bbox: { x0: 0, y0: 720, x1: 200, y1: 760 } },
        ],
        cropHeight,
      ),
    );

    // Digits-only value column (no commas).
    const values = normalizeGeometryLines(
      [
        { text: "164615505", bbox: { x0: 0, y0: 40, x1: 120, y1: 80 } },
        { text: "85868520", bbox: { x0: 0, y0: 120, x1: 120, y1: 160 } },
        { text: "37811658", bbox: { x0: 0, y0: 210, x1: 120, y1: 250 } },
        { text: "13190850", bbox: { x0: 0, y0: 280, x1: 120, y1: 320 } },
        { text: "9408080", bbox: { x0: 0, y0: 360, x1: 120, y1: 400 } },
        { text: "7051707", bbox: { x0: 0, y0: 440, x1: 120, y1: 480 } },
        { text: "6581990", bbox: { x0: 0, y0: 520, x1: 120, y1: 560 } },
        { text: "4702700", bbox: { x0: 0, y0: 600, x1: 120, y1: 640 } },
        { text: "11803262", bbox: { x0: 0, y0: 720, x1: 120, y1: 760 } },
      ],
      cropHeight,
    );

    const pairs = zipLabelsToValues({ labels, values });
    // Header label skipped; drone stop prevents pairing drone total as a component.
    expect(pairs.map((p) => p.key)).toEqual([
      "heroLevel",
      "decorationsAndBuildings",
      "gear",
      "exclusiveWeapons",
      "heroTier",
      "heroSkill",
      "wallOfHonor",
    ]);

    const parsed = assembleGeometryParse({
      pairs,
      headerTotal: JUL20_EXPECTED.heroPowerTotal,
    });
    expect(parsed.complete).toBe(true);
    expect(parsed.heroPowerTotal).toBe(JUL20_EXPECTED.heroPowerTotal);
    expect(parsed.breakdown).toEqual(JUL20_EXPECTED.breakdown);
    expect(sumThpBreakdown(parsed.breakdown as ThpBreakdown)).toBe(
      JUL20_EXPECTED.heroPowerTotal,
    );
  });

  it("marks incomplete when component sum disagrees with header (no digit surgery)", () => {
    const labels = normalizeGeometryLines(
      [
        { text: "Hero Level", bbox: { x0: 0, y0: 10, x1: 10, y1: 20 } },
        {
          text: "Decorations & Building Stats",
          bbox: { x0: 0, y0: 30, x1: 10, y1: 40 },
        },
        { text: "Gear", bbox: { x0: 0, y0: 50, x1: 10, y1: 60 } },
        { text: "Exclusive Weapon", bbox: { x0: 0, y0: 70, x1: 10, y1: 80 } },
        { text: "Hero Tier", bbox: { x0: 0, y0: 90, x1: 10, y1: 100 } },
        { text: "Hero Skill", bbox: { x0: 0, y0: 110, x1: 10, y1: 120 } },
        { text: "Wall of Honor", bbox: { x0: 0, y0: 130, x1: 10, y1: 140 } },
      ],
      200,
    );
    const values = normalizeGeometryLines(
      [
        { text: "1000000", bbox: { x0: 0, y0: 10, x1: 10, y1: 20 } },
        { text: "1000000", bbox: { x0: 0, y0: 30, x1: 10, y1: 40 } },
        { text: "1000000", bbox: { x0: 0, y0: 50, x1: 10, y1: 60 } },
        { text: "1000000", bbox: { x0: 0, y0: 70, x1: 10, y1: 80 } },
        { text: "1000000", bbox: { x0: 0, y0: 90, x1: 10, y1: 100 } },
        { text: "1000000", bbox: { x0: 0, y0: 110, x1: 10, y1: 120 } },
        { text: "1000000", bbox: { x0: 0, y0: 130, x1: 10, y1: 140 } },
      ],
      200,
    );
    const pairs = zipLabelsToValues({ labels, values });
    const parsed = assembleGeometryParse({
      pairs,
      headerTotal: 164_615_505,
    });
    expect(parsed.complete).toBe(false);
    expect(parsed.pairedCount).toBe(7);
  });
});
