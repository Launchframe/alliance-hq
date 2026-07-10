import { describe, expect, it } from "vitest";

import {
  buildDailyGrid,
  formatDailyRangeLabel,
} from "@/lib/battle-plan/calendar-view.shared";

describe("battle plan calendar view", () => {
  it("builds three day cells from an anchor date", () => {
    expect(buildDailyGrid("2026-07-10").map((cell) => cell.date)).toEqual([
      "2026-07-10",
      "2026-07-11",
      "2026-07-12",
    ]);
  });

  it("formats the visible daily range label", () => {
    expect(formatDailyRangeLabel("2026-07-10")).toBe("2026-07-10 – 2026-07-12");
  });
});
