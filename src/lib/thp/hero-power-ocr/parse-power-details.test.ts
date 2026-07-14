import { describe, expect, it } from "vitest";

import {
  coalescePowerDetailsLines,
  parsePowerDetailsLines,
  reconcileBreakdownToTotal,
  stripOcrCommaSevens,
} from "@/lib/thp/hero-power-ocr/parse-power-details";
import { sumThpBreakdown } from "@/lib/thp/breakdown.shared";

describe("stripOcrCommaSevens", () => {
  it("removes 7s that sit in thousand-separator slots", () => {
    expect(stripOcrCommaSevens("1478337300")).toBe("14833300");
    expect(stripOcrCommaSevens("16373817480")).toBe("163381480");
    expect(stripOcrCommaSevens("8577957832")).toBe("85795832");
    expect(stripOcrCommaSevens("1278887896")).toBe("12888896");
    expect(stripOcrCommaSevens("970857358")).toBe("9085358");
    expect(stripOcrCommaSevens("477027700")).toBe("4702700");
  });

  it("does not strip real component values that contain 7s", () => {
    expect(stripOcrCommaSevens("7053833")).toBeNull();
    expect(stripOcrCommaSevens("4702700")).toBeNull();
    expect(stripOcrCommaSevens("6574310")).toBeNull();
    expect(stripOcrCommaSevens("85857448")).toBeNull();
  });
});

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
    // No Hero Power header → not submission-ready (separator glue can inflate rows).
    expect(parsed.complete).toBe(false);
    expect(parsed.heroPowerTotal).toBeNull();
    expect(parsed.breakdown).toEqual({
      heroLevel: 85_857_448,
      decorationsAndBuildings: 37_282_702,
      gear: 133_118_094,
      exclusiveWeapons: 90_857_358,
      heroTier: 12_053_833,
      heroSkill: 6_574_310,
      wallOfHonor: 4_502_300,
    });
  });

  it("rejects complete when header and components cannot be reconciled", () => {
    const lines = [
      "Hero Power 100,000,000",
      "Hero Level 50,000,000",
      "Decorations & Building Stats 20,000,000",
      "Gear 10,000,000",
      "Exclusive Weapon 10,000,000",
      "Hero Tier 5,000,000",
      "Hero Skill 5,000,000",
      "Wall of Honor 9,999,999",
    ];
    const parsed = parsePowerDetailsLines(lines);
    expect(parsed.complete).toBe(false);
    // Keep the header for total-only fallback; do not invent a matching sum.
    expect(parsed.heroPowerTotal).toBe(100_000_000);
    expect(sumThpBreakdown(parsed.breakdown as never)).toBe(109_999_999);
  });

  it("rejects complete when two destroyed stubs block reconciliation", () => {
    const lines = [
      "Hero Power 163,674,445",
      "Hero Level 85,857,448",
      "Decorations & Building Stats 37,282,702",
      "Gear 13,118,094",
      "Exclusive Weapon 9,085,358",
      "Hero Tier 7,053,833",
      "Hero Skill 123",
      "Wall of Honor 456",
    ];
    const parsed = parsePowerDetailsLines(lines);
    expect(parsed.complete).toBe(false);
    expect(parsed.heroPowerTotal).toBe(163_674_445);
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

  it("parses the Jul 14 screenshot when commas were OCR'd as 7s", () => {
    const lines = [
      "Hero Power 16373817480",
      "Hero Level 8577957832",
      "Decorations & Building",
      "Stats 37293172",
      "Gear 1278887896",
      "Exclusive Weapon 970857358",
      "Hero Tier 770417212",
      "Hero Skill 6574310",
      "Wall of Honor 477027700",
      "Drone Level 5346950",
      "Buildings 1478337300",
    ];
    const parsed = parsePowerDetailsLines(lines);
    expect(parsed.complete).toBe(true);
    expect(parsed.heroPowerTotal).toBe(163_381_480);
    expect(parsed.breakdown).toEqual({
      heroLevel: 85_795_832,
      decorationsAndBuildings: 37_293_172,
      gear: 12_888_896,
      exclusiveWeapons: 9_085_358,
      heroTier: 7_041_212,
      heroSkill: 6_574_310,
      wallOfHonor: 4_702_700,
    });
  });

  it("parses German (DE) screenshot with period/apostrophe separators", () => {
    // Diagnostics from German-locale Power Details ("Details der Kampfkraft").
    // German uses periods as thousand-separators and labels like "Heldenlevel",
    // "Ausrüstung", "Heldenrang", "Helden-Fähigkeit", "Ehrenwand".
    const lines = [
      "Heldenkampfkraft 163'766'614",
      "Heldenlevel 85'868'512",
      "Dekorationen und",
      "Gebaudestatistiken 37'293'177",
      "Ausriistung 13'190'850",
      "Exklusive Waffe 9'085'358",
      "Heldenrang 7'051'707",
      "Helden-Fahigkeit 6'574'310",
      "Ehrenwand 4'702'700",
      "Drohnen-Kampfkraft 11'803'262",
    ];
    const parsed = parsePowerDetailsLines(lines);
    expect(parsed.heroPowerTotal).toBe(163_766_614);
    expect(parsed.complete).toBe(true);
    expect(parsed.breakdown).toEqual({
      heroLevel: 85_868_512,
      decorationsAndBuildings: 37_293_177,
      gear: 13_190_850,
      exclusiveWeapons: 9_085_358,
      heroTier: 7_051_707,
      heroSkill: 6_574_310,
      wallOfHonor: 4_702_700,
    });
  });

  it("parses noisy German OCR with mixed separators and digit confusion", () => {
    // Real OCR diagnostics from German screenshot — note the mix of apostrophes,
    // periods, colons, exclamation marks, and brackets in number positions.
    const lines = [
      "Heldenkampfkraft 163'766%614",
      "Heldenlevel 85'868!512",
      "Dekorationen und 293",
      "Gebaudestatistiken 37293177",
      "Ausriistung 13190'850",
      "Exklusive Waffe 9'085'358",
      "Heldenrang 7.051707",
      "Helden-Fahigkeit 6'574'310",
      "Ehrenwand 4702700",
      "Drohnen-Level 5'349'852",
    ];
    const parsed = parsePowerDetailsLines(lines);
    expect(parsed.heroPowerTotal).toBe(163_766_614);
    expect(parsed.complete).toBe(true);
    expect(parsed.breakdown.heroLevel).toBe(85_868_512);
    expect(parsed.breakdown.gear).toBe(13_190_850);
    expect(parsed.breakdown.heroTier).toBe(7_051_707);
    expect(parsed.breakdown.heroSkill).toBe(6_574_310);
    expect(parsed.breakdown.wallOfHonor).toBe(4_702_700);
  });

  it("recovers Hero Power total from live dual-pass OCR lines", () => {
    // Real dual-pass output from the Jul 14 screenshot: header commas→digits mix,
    // body still drops/duplicates glyphs on some rows.
    const lines = [
      "POWER DETAILS",
      "{E)[Herolpower, 163}381/480] v/",
      "Hero Level B85%95'832",
      "Decorations & Building",
      "Stats 37293172",
      "Gear 12/8881896",
      "Exclusive Weapon 9085358",
      "Hero Tier 1710414212,",
      "Hero Skill 61574310]",
      "Wall of Honor 40200",
      "Drone Level 513461950",
    ];
    const parsed = parsePowerDetailsLines(lines);
    expect(parsed.heroPowerTotal).toBe(163_381_480);
    expect(parsed.breakdown.decorationsAndBuildings).toBe(37_293_172);
    expect(parsed.breakdown.exclusiveWeapons).toBe(9_085_358);
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
