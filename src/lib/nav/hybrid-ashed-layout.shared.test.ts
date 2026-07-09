import { describe, expect, it } from "vitest";

import {
  DEFAULT_HYBRID_ASHED_LAYOUT,
  parseHybridAshedLayoutPrefs,
} from "@/lib/nav/hybrid-ashed-layout.shared";

describe("hybrid-ashed-layout.shared", () => {
  it("returns defaults for invalid input", () => {
    expect(parseHybridAshedLayoutPrefs(null)).toEqual(DEFAULT_HYBRID_ASHED_LAYOUT);
  });

  it("clamps hq ratio", () => {
    const prefs = parseHybridAshedLayoutPrefs({
      mobile: { activePane: "hq" },
      desktop: { hqRatio: 0.05, hqCollapsed: false, ashedCollapsed: false },
    });
    expect(prefs.desktop.hqRatio).toBe(0.25);
  });

  it("reopens HQ when both panes collapsed", () => {
    const prefs = parseHybridAshedLayoutPrefs({
      mobile: { activePane: "hq" },
      desktop: { hqRatio: 0.5, hqCollapsed: true, ashedCollapsed: true },
    });
    expect(prefs.desktop.hqCollapsed).toBe(false);
    expect(prefs.desktop.ashedCollapsed).toBe(true);
  });
});
