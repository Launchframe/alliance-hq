import { describe, expect, it } from "vitest";

import {
  openingMenuProbeTimestamps,
  textShowsLeaderboardMenu,
} from "./opening-menu-probe.shared";

describe("openingMenuProbeTimestamps", () => {
  it("starts at the first decoded frame and doubles the step", () => {
    const stamps = openingMenuProbeTimestamps(30, 1);
    expect(stamps[0]).toBe(0);
    expect(stamps[1]).toBeCloseTo(1 / 30, 5);
    expect(stamps[2]).toBeCloseTo(3 / 30, 5);
    expect(stamps[3]).toBeCloseTo(7 / 30, 5);
    expect(stamps.at(-1)!).toBeLessThanOrEqual(1);
    expect(stamps.length).toBeLessThanOrEqual(6);
  });
});

describe("textShowsLeaderboardMenu", () => {
  it("matches the Daily Rank tab and the column headers", () => {
    expect(textShowsLeaderboardMenu("Daily Rank\nWeekly Rank")).toBe(true);
    expect(
      textShowsLeaderboardMenu("Ranking Commander Points\n1 Jin"),
    ).toBe(true);
  });

  it("does not treat a scrolled list without the menu as a hit", () => {
    expect(textShowsLeaderboardMenu("AanRockID 16246556")).toBe(false);
  });
});
