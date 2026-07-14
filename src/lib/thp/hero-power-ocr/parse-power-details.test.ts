import { describe, expect, it } from "vitest";

import {
  coalescePowerDetailsLines,
  parsePowerDetailsLines,
  reconcileBreakdownToTotal,
} from "@/lib/thp/hero-power-ocr/parse-power-details";
import { sumThpBreakdown } from "@/lib/thp/breakdown.shared";

describe("parsePowerDetailsLines", () => {
  it("parses clean hero power total and all seven components", () => {
    const lines = [
      "POWER DETAILS",
      "Hero Power 163,460,435",
      "Hero Level 85,813,080",
      "Decorations & Building Stats 37,214,389",
      "Gear 13,059,233",
      "Exclusive Weapon 9,059,449",
      "Hero Tier 7,050,714",
      "Hero Skill 6,560,870",
      "Wall of Honor 4,702,700",
    ];
    const parsed = parsePowerDetailsLines(lines);
    expect(parsed.heroPowerTotal).toBe(163_460_435);
    expect(parsed.complete).toBe(true);
    expect(parsed.breakdown.heroTier).toBe(7_050_714);
  });

  it("parses Discord OCR noise where commas become apostrophes/dashes/brackets", () => {
    // Real thp_screenshot diagnostics sample (apostrophe/slash/bracket separators).
    const lines = [
      "Hero Level 85'857/448)",
      "Decorations & Building",
      "Stats 37282702",
      "Gear 1331-18094",
      "Exclusive Weapon 90857358",
      "Hero Tier 12,053'833]",
      "Hero Skill 6'574'310",
      "Wall of Honor 4502300",
    ];
    const parsed = parsePowerDetailsLines(lines);
    expect(parsed.complete).toBe(true);
    expect(parsed.breakdown).toEqual({
      heroLevel: 85_857_448,
      decorationsAndBuildings: 37_282_702,
      gear: 133_118_094,
      exclusiveWeapons: 90_857_358,
      heroTier: 12_053_833,
      heroSkill: 6_574_310,
      wallOfHonor: 4_502_300,
    });
    // No header total in this capture — fall back to component sum.
    expect(parsed.heroPowerTotal).toBe(sumThpBreakdown(parsed.breakdown as never));
  });

  it("repairs confusable 7 digits when header total is present", () => {
    const expectedTotal =
      85_857_448 +
      37_282_702 +
      133_118_094 +
      90_857_358 +
      7_053_833 +
      6_574_310 +
      4_702_700;

    const lines = [
      `Hero Power ${expectedTotal}`,
      "Hero Level 85'857/448)",
      "Decorations & Building Stats 37282702",
      "Gear 1331-18094",
      "Exclusive Weapon 90857358",
      // OCR read crossed 7 as 12…; true value 7,053,833
      "Hero Tier 12,053'833]",
      "Hero Skill 6'574'310",
      // OCR read 7s as 5/3; true value 4,702,700
      "Wall of Honor 4502300",
    ];
    const parsed = parsePowerDetailsLines(lines);
    expect(parsed.complete).toBe(true);
    expect(parsed.heroPowerTotal).toBe(expectedTotal);
    expect(parsed.breakdown.heroTier).toBe(7_053_833);
    expect(parsed.breakdown.wallOfHonor).toBe(4_702_700);
  });

  it("repairs Discord diagnostics sample with destroyed wall and oversized blobs", () => {
    const lines = [
      "Hero Power 163,674,445",
      "Hero Level 85'857244 8!",
      "Decorations & Building",
      "Stats 37282702",
      "Gear 1331187094",
      "Exclusive Weapon 91085358",
      "Hero Tier 12,053'833!",
      "Hero Skill 6'574'310",
      "Wall of Honor 4%,02¥,00",
      "Drone Level 52346'950",
    ];
    const parsed = parsePowerDetailsLines(lines);
    expect(parsed.complete).toBe(true);
    expect(parsed.heroPowerTotal).toBe(163_674_445);
    expect(parsed.breakdown).toEqual({
      heroLevel: 85_857_448,
      decorationsAndBuildings: 37_282_702,
      gear: 13_118_094,
      exclusiveWeapons: 9_085_358,
      heroTier: 7_053_833,
      heroSkill: 6_574_310,
      wallOfHonor: 4_702_700,
    });
  });

  it("treats % and currency glyphs as thousand-separators in component values", () => {
    const lines = [
      "Hero Power 163,674,445",
      "Hero Level 85%857'448",
      "Decorations & Building Stats 37282702",
      "Gear 13,118'094",
      "Exclusive Weapon 9,085'358",
      "Hero Tier 7,053'833",
      "Hero Skill 6!574'310",
      "Wall of Honor 4%,02¥,00",
    ];
    const parsed = parsePowerDetailsLines(lines);
    expect(parsed.complete).toBe(true);
    expect(parsed.breakdown.heroLevel).toBe(85_857_448);
    expect(parsed.breakdown.heroSkill).toBe(6_574_310);
    expect(parsed.breakdown.wallOfHonor).toBe(4_702_700);
  });

  it("marks incomplete when Hero Power header and Hero Tier are both missing", () => {
    // Live Discord sample: body rows only — dual-pass OCR must recover header/tier.
    const lines = [
      "Hero Level 85%95'832",
      "Decorations & Building",
      "Stats 37283472",
      "Gear 12,888'896",
      "Exclusive Weapon 91085358",
      "Hero Skill 6!5743310",
      "Wall of Honor 40200",
      "Drone Level 513467950",
    ];
    const parsed = parsePowerDetailsLines(lines);
    expect(parsed.complete).toBe(false);
    expect(parsed.breakdown.heroTier).toBeUndefined();
    expect(parsed.heroPowerTotal).toBeNull();
  });
});

describe("coalescePowerDetailsLines", () => {
  it("joins decorations label with following stats value line", () => {
    expect(
      coalescePowerDetailsLines([
        "Decorations & Building",
        "Stats 37,282,702",
        "Gear 1,234",
      ]),
    ).toEqual([
      "Decorations & Building Stats 37,282,702",
      "Gear 1,234",
    ]);
  });
});

describe("reconcileBreakdownToTotal", () => {
  it("rewrites leading 12→7 on heroTier when that matches the total", () => {
    const breakdown = {
      heroLevel: 10,
      decorationsAndBuildings: 10,
      gear: 10,
      exclusiveWeapons: 10,
      heroTier: 12_053_833,
      heroSkill: 10,
      wallOfHonor: 10,
    };
    const target = sumThpBreakdown({ ...breakdown, heroTier: 7_053_833 });
    const repaired = reconcileBreakdownToTotal(breakdown, target);
    expect(repaired.heroTier).toBe(7_053_833);
  });

  it("repairs wall-of-honor 7 confusions in one component", () => {
    const breakdown = {
      heroLevel: 10,
      decorationsAndBuildings: 10,
      gear: 10,
      exclusiveWeapons: 10,
      heroTier: 10,
      heroSkill: 10,
      wallOfHonor: 4_502_300,
    };
    const target = sumThpBreakdown({ ...breakdown, wallOfHonor: 4_702_700 });
    const repaired = reconcileBreakdownToTotal(breakdown, target);
    expect(repaired.wallOfHonor).toBe(4_702_700);
  });
});
