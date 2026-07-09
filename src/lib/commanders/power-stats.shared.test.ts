import { describe, expect, it } from "vitest";

import {
  commanderPowerLevelDisplay,
  commanderThpTotal,
  formatThpDisplay,
  normalizePowerLevelString,
  parsePowerLevelM,
  resolveThpTotalFromSnapshot,
} from "@/lib/commanders/power-stats.shared";

describe("commanderThpTotal", () => {
  it("returns rounded THP when set", () => {
    expect(commanderThpTotal({ currentTotalHeroPower: 163_460_435.2 })).toBe(
      163_460_435,
    );
  });

  it("returns 0 when absent", () => {
    expect(commanderThpTotal({ currentTotalHeroPower: null })).toBe(0);
  });
});

describe("resolveThpTotalFromSnapshot", () => {
  it("reads currentTotalHeroPower only", () => {
    expect(
      resolveThpTotalFromSnapshot({ currentTotalHeroPower: 100_000_000 }),
    ).toBe(100_000_000);
    expect(resolveThpTotalFromSnapshot({ currentTotalHeroPower: null })).toBe(
      null,
    );
  });
});

describe("commanderPowerLevelDisplay", () => {
  it("formats power level string", () => {
    expect(commanderPowerLevelDisplay({ powerLevel: "162.8M" })).toBe("162.8M");
    expect(commanderPowerLevelDisplay({ powerLevel: null })).toBe("—");
  });
});

describe("parsePowerLevelM", () => {
  it("parses millions from display string", () => {
    expect(parsePowerLevelM("118.2M")).toBeCloseTo(118.2);
  });
});

describe("normalizePowerLevelString", () => {
  it("prefers powerLevel over heroPowerM", () => {
    expect(
      normalizePowerLevelString({ powerLevel: "120M", heroPowerM: 118.2 }),
    ).toBe("120M");
    expect(normalizePowerLevelString({ heroPowerM: 118.2 })).toBe("118.2M");
  });
});

describe("formatThpDisplay", () => {
  it("formats integers with grouping", () => {
    expect(formatThpDisplay(1_234_567)).toBe("1,234,567");
    expect(formatThpDisplay(0)).toBe("—");
  });
});
