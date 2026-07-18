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

  it("parses Brazilian Portuguese (pt-BR) screenshot labels", () => {
    // From "Detalhes do Poder" screenshot — pt-BR uses comma thousand separators
    // (same as English) but distinct labels. Row order also differs from EN/DE
    // (Habilidade before Categoria, Arma Exclusiva after both).
    const lines = [
      "Poder do Heroi 126,107,918",
      "Nivel do Heroi 68,968,904",
      "Decoracoes e Atributos de Construcao 27,322,648",
      "Equipamento 11,512,123",
      "Habilidade de Heroi 5,905,810",
      "Categoria de Heroi 5,877,961",
      "Arma Exclusiva 5,025,497",
      "Mural de Honra 1,494,975",
      "Poder do Drone 9,358,364",
      "Nivel do Drone 4,575,346",
    ];
    const parsed = parsePowerDetailsLines(lines);
    expect(parsed.heroPowerTotal).toBe(126_107_918);
    expect(parsed.complete).toBe(true);
    expect(parsed.breakdown).toEqual({
      heroLevel: 68_968_904,
      decorationsAndBuildings: 27_322_648,
      gear: 11_512_123,
      exclusiveWeapons: 5_025_497,
      heroTier: 5_877_961,
      heroSkill: 5_905_810,
      wallOfHonor: 1_494_975,
    });
  });

  it("parses wrapped Brazilian Portuguese decorations label", () => {
    // Long label "Decorações e Atributos de Construção" often wraps across
    // two OCR lines, similar to German "Dekorationen und / Gebäudestatistiken".
    const lines = [
      "Poder do Herói 126.107.918",
      "Nível do Herói 68.968.904",
      "Decorações e Atributos",
      "de Construção 27.322.648",
      "Equipamento 11.512.123",
      "Habilidade de Herói 5.905.810",
      "Categoria de Herói 5.877.961",
      "Arma Exclusiva 5.025.497",
      "Mural de Honra 1.494.975",
      "Poder de Construção 16.358.542",
    ];
    const parsed = parsePowerDetailsLines(lines);
    expect(parsed.heroPowerTotal).toBe(126_107_918);
    expect(parsed.complete).toBe(true);
    expect(parsed.breakdown.decorationsAndBuildings).toBe(27_322_648);
    expect(parsed.breakdown.heroLevel).toBe(68_968_904);
    expect(parsed.breakdown.wallOfHonor).toBe(1_494_975);
  });

  it("parses Korean (KO) screenshot labels", () => {
    // From "전투력 정보" screenshot — Hangul labels with English-style commas.
    // Row order matches pt-BR (skill before tier, exclusive weapon after both).
    const lines = [
      "영웅 전투력 126,107,918",
      "영웅 레벨 68,968,904",
      "장식 및 건물 능력치 27,322,648",
      "장비 11,512,123",
      "영웅 스킬 5,905,810",
      "영웅 티어 5,877,961",
      "전속 무기 5,025,497",
      "명예의 전당 1,494,975",
      "드론 전투력 9,358,364",
      "드론 레벨 4,575,346",
      "건물 전투력 16,361,642",
    ];
    const parsed = parsePowerDetailsLines(lines);
    expect(parsed.heroPowerTotal).toBe(126_107_918);
    expect(parsed.complete).toBe(true);
    expect(parsed.breakdown).toEqual({
      heroLevel: 68_968_904,
      decorationsAndBuildings: 27_322_648,
      gear: 11_512_123,
      exclusiveWeapons: 5_025_497,
      heroTier: 5_877_961,
      heroSkill: 5_905_810,
      wallOfHonor: 1_494_975,
    });
  });

  it("parses wrapped Korean decorations label", () => {
    // "장식 및 건물 능력치" can wrap; second half must not trip the
    // building section stop (which is specifically "건물 전투력").
    const lines = [
      "영웅 전투력 126,107,918",
      "영웅 레벨 68,968,904",
      "장식 및",
      "건물 능력치 27,322,648",
      "장비 11,512,123",
      "영웅 스킬 5,905,810",
      "영웅 티어 5,877,961",
      "전속 무기 5,025,497",
      "명예의 전당 1,494,975",
      "드론 전투력 9,358,364",
    ];
    const parsed = parsePowerDetailsLines(lines);
    expect(parsed.heroPowerTotal).toBe(126_107_918);
    expect(parsed.complete).toBe(true);
    expect(parsed.breakdown.decorationsAndBuildings).toBe(27_322_648);
    expect(parsed.breakdown.gear).toBe(11_512_123);
  });

  it("parses Mexican Spanish (es-MX) screenshot labels", () => {
    // From "DETALLES DE PODER" screenshot — distinct from pt-BR (de/Héroe vs
    // do/Herói, Equipamiento, Rango, Muro de Honor).
    const lines = [
      "Poder de Heroe 126,107,918",
      "Nivel de Heroe 68,968,904",
      "Decoraciones y Estadisticas de Construccion 27,322,648",
      "Equipamiento 11,512,123",
      "Habilidad de Heroe 5,905,810",
      "Rango de Heroe 5,877,961",
      "Arma Exclusiva 5,025,497",
      "Muro de Honor 1,494,975",
      "Poder de Dron 9,358,364",
      "Nivel de Dron 4,575,346",
      "Poder de Edificio 16,361,642",
    ];
    const parsed = parsePowerDetailsLines(lines);
    expect(parsed.heroPowerTotal).toBe(126_107_918);
    expect(parsed.complete).toBe(true);
    expect(parsed.breakdown).toEqual({
      heroLevel: 68_968_904,
      decorationsAndBuildings: 27_322_648,
      gear: 11_512_123,
      exclusiveWeapons: 5_025_497,
      heroTier: 5_877_961,
      heroSkill: 5_905_810,
      wallOfHonor: 1_494_975,
    });
  });

  it("parses wrapped Mexican Spanish decorations label", () => {
    const lines = [
      "Poder de Héroe 126,107,918",
      "Nivel de Héroe 68,968,904",
      "Decoraciones y",
      "Estadísticas de Construcción 27,322,648",
      "Equipamiento 11,512,123",
      "Habilidad de Héroe 5,905,810",
      "Rango de Héroe 5,877,961",
      "Arma Exclusiva 5,025,497",
      "Muro de Honor 1,494,975",
      "Edificios 12,389,000",
    ];
    const parsed = parsePowerDetailsLines(lines);
    expect(parsed.heroPowerTotal).toBe(126_107_918);
    expect(parsed.complete).toBe(true);
    expect(parsed.breakdown.decorationsAndBuildings).toBe(27_322_648);
    expect(parsed.breakdown.wallOfHonor).toBe(1_494_975);
  });

  it("recovers Jul 18 screenshot when header total is on a bare OCR line", () => {
    // Live Discord sample: body header is gibberish ("BABELED"), dual-pass
    // header band emits the total alone. Component commas land as mixed digits
    // (7/1/8) with the other separator dropped → 9-digit blobs.
    const lines = [
      "164,613,299",
      "(&))[HerolPower, BABELED &",
      "Hero Level 857868520",
      "Decorations & Building 371809752",
      "Stats",
      "Gear 138190850",
      "Exclusive Weapon 974087080",
      "Hero Tier 12/051%7,07,",
      "Hero Skill 6!581'990",
      "Wall of Honor 4%02¥00",
      "R4D10nePower, 11'803%262]'v",
      "Drone Level 513497852:",
      "Skill Chip 37462800",
    ];
    const parsed = parsePowerDetailsLines(lines);
    expect(parsed.heroPowerTotal).toBe(164_613_299);
    expect(parsed.complete).toBe(true);
    // Oversized 9-digit blobs above the header are collapsed; tier 12→7.
    expect(parsed.breakdown.heroLevel).toBe(85_868_520);
    expect(parsed.breakdown.exclusiveWeapons).toBe(9_408_080);
    expect(parsed.breakdown.heroTier).toBe(7_051_707);
    expect(parsed.breakdown.heroSkill).toBe(6_581_990);
    expect(
      Object.values(parsed.breakdown).reduce((a, b) => a + (b ?? 0), 0),
    ).toBe(164_613_299);
  });

  it("peeks the next line when Hero Power label has no trailing total", () => {
    const lines = [
      "Hero Power",
      "164613299",
      "Hero Level 85,868,520",
      "Decorations & Building Stats 37,809,452",
      "Gear 13,190,850",
      "Exclusive Weapon 9,408,080",
      "Hero Tier 7,051,707",
      "Hero Skill 6,581,990",
      "Wall of Honor 4,702,700",
    ];
    const parsed = parsePowerDetailsLines(lines);
    expect(parsed.heroPowerTotal).toBe(164_613_299);
    expect(parsed.complete).toBe(true);
  });

  it("repairs header total > 1B where a comma was OCR'd as a digit", () => {
    // Real sample: header "163,843,831" reads as "1637843831" (comma→7 in header).
    // Components also have commas absorbed as various digits (7, 1, 8).
    // Multiple cost-1 header repairs reconcile; verify the >1B raw value is rejected
    // and a reasonable ~164M value is found instead.
    const lines = [
      "Hero Power 1637843831",
      "Hero Level 8578681512",
      "Decorations & Building",
      "Stats 37370394",
      "Gear 138190850",
      "Exclusive Weapon 91085358",
      "Hero Tier 12/051%7,07,",
      "Hero Skill 6'574'310",
      "Wall of Honor 4%02¥00",
    ];
    const parsed = parsePowerDetailsLines(lines);
    expect(parsed.heroPowerTotal).toBeGreaterThan(160_000_000);
    expect(parsed.heroPowerTotal).toBeLessThan(165_000_000);
    expect(parsed.complete).toBe(true);
    expect(parsed.breakdown.heroTier).toBe(7_051_707);
    expect(parsed.breakdown.heroSkill).toBe(6_574_310);
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
