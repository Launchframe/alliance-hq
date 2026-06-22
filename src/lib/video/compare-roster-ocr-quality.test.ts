import { describe, expect, it } from "vitest";

import {
  compareRosterOcrQuality,
  rosterNameSimilarity,
  type RosterCompareRow,
} from "@/lib/video/compare-roster-ocr-quality";

function row(
  name: string,
  allianceRank: number | null = null,
  heroPowerM: number | null = null,
  memberLevel: number | null = null,
): RosterCompareRow {
  return { name, allianceRank, heroPowerM, memberLevel };
}

describe("compareRosterOcrQuality", () => {
  it("computes perfect recall and precision when names align", () => {
    const primary = [row("Alpha", 3, 4.2, 85), row("Beta", 2, 1.1, 40)];
    const shadow = [row("Alpha", 3, 4.2, 85), row("Beta", 2, 1.1, 40)];

    const metrics = compareRosterOcrQuality(primary, shadow);
    expect(metrics.nameRecall).toBe(1);
    expect(metrics.namePrecision).toBe(1);
    expect(metrics.rankAgreement).toBe(1);
    expect(metrics.powerAgreement).toBe(1);
    expect(metrics.levelAgreement).toBe(1);
    expect(metrics.matchedNameCount).toBe(2);
    expect(metrics.onlyInPrimary).toBe(0);
    expect(metrics.onlyInShadow).toBe(0);
  });

  it("matches fuzzy names above threshold", () => {
    const primary = [row("Cmoney1985", 5, 162.8, 30)];
    const shadow = [row("Cmoney 1985", 5, 162.8, 30)];

    expect(rosterNameSimilarity("Cmoney1985", "Cmoney 1985")).toBeGreaterThanOrEqual(
      0.6,
    );

    const metrics = compareRosterOcrQuality(primary, shadow);
    expect(metrics.nameRecall).toBe(1);
    expect(metrics.namePrecision).toBe(1);
    expect(metrics.rankAgreement).toBe(1);
  });

  it("reports misses and extra rows", () => {
    const primary = [row("Alpha", 3), row("Beta", 2)];
    const shadow = [row("Alpha", 3), row("Gamma", 1)];

    const metrics = compareRosterOcrQuality(primary, shadow);
    expect(metrics.matchedNameCount).toBe(1);
    expect(metrics.onlyInPrimary).toBe(1);
    expect(metrics.onlyInShadow).toBe(1);
    expect(metrics.nameRecall).toBe(0.5);
    expect(metrics.namePrecision).toBe(0.5);
  });

  it("computes rank agreement only on comparable matched rows", () => {
    const primary = [row("Alpha", 3), row("Beta", 2)];
    const shadow = [row("Alpha", 4), row("Beta", 2)];

    const metrics = compareRosterOcrQuality(primary, shadow);
    expect(metrics.rankAgreement).toBe(0.5);
  });
});
