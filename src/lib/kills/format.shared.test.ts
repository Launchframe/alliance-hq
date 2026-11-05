import { describe, expect, it } from "vitest";

import { commanderKillsTotal, formatKillsDisplay } from "@/lib/kills/format.shared";

describe("commanderKillsTotal", () => {
  it("treats missing, non-finite, and non-positive kills as unreported", () => {
    expect(commanderKillsTotal({})).toBeNull();
    expect(commanderKillsTotal({ currentKills: null })).toBeNull();
    expect(commanderKillsTotal({ currentKills: 0 })).toBeNull();
    expect(commanderKillsTotal({ currentKills: -5 })).toBeNull();
    expect(commanderKillsTotal({ currentKills: Number.NaN })).toBeNull();
  });

  it("rounds reported kills to whole numbers", () => {
    expect(commanderKillsTotal({ currentKills: 1_234.6 })).toBe(1_235);
  });
});

describe("formatKillsDisplay", () => {
  it("shows a dash for unreported kills", () => {
    expect(formatKillsDisplay(null, "en-US")).toBe("—");
    expect(formatKillsDisplay(0, "en-US")).toBe("—");
  });

  it("formats with the active locale", () => {
    expect(formatKillsDisplay(1_234_567, "en-US")).toBe("1,234,567");
    expect(formatKillsDisplay(1_234_567, "pt-BR")).toBe("1.234.567");
  });
});
