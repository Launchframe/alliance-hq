import { describe, expect, it } from "vitest";

import {
  formatCrystalGoldAsK,
  parseCrystalGoldKInput,
} from "@/lib/banks/crystal-gold-k.shared";

describe("formatCrystalGoldAsK", () => {
  it("formats absolute CrystalGold as K with two decimals", () => {
    expect(formatCrystalGoldAsK(660_000)).toBe("660.00K");
    expect(formatCrystalGoldAsK(447_380)).toBe("447.38K");
  });

  it("returns empty for null / invalid", () => {
    expect(formatCrystalGoldAsK(null)).toBe("");
    expect(formatCrystalGoldAsK(undefined)).toBe("");
    expect(formatCrystalGoldAsK(Number.NaN)).toBe("");
  });
});

describe("parseCrystalGoldKInput", () => {
  it("parses bare and K-suffixed amounts", () => {
    expect(parseCrystalGoldKInput("660")).toBe(660_000);
    expect(parseCrystalGoldKInput("660.00")).toBe(660_000);
    expect(parseCrystalGoldKInput("660.00K")).toBe(660_000);
    expect(parseCrystalGoldKInput("660.00k")).toBe(660_000);
    expect(parseCrystalGoldKInput("447.38K")).toBe(447_380);
  });

  it("returns null for empty, invalid, or M/B suffixes", () => {
    expect(parseCrystalGoldKInput("")).toBeNull();
    expect(parseCrystalGoldKInput("  ")).toBeNull();
    expect(parseCrystalGoldKInput("abc")).toBeNull();
    expect(parseCrystalGoldKInput("3.48M")).toBeNull();
    expect(parseCrystalGoldKInput("1B")).toBeNull();
  });

  it("round-trips with formatCrystalGoldAsK", () => {
    const absolute = 660_000;
    expect(parseCrystalGoldKInput(formatCrystalGoldAsK(absolute))).toBe(
      absolute,
    );
  });
});
