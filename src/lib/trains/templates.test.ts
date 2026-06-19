import { describe, expect, it } from "vitest";

import {
  addCalendarDays,
  buildMonthGrid,
  getServerCalendarDate,
  getWeekStartMonday,
  monthEndFromKey,
} from "@/lib/trains/game-time";
import { generateDayConfigForDate, generateWeekDayConfigs, supportsManualConductorPick } from "@/lib/trains/templates";

describe("train game-time", () => {
  it("maps UTC instant to server calendar date", () => {
    expect(
      getServerCalendarDate(new Date("2026-06-11T01:30:00.000Z")),
    ).toBe("2026-06-10");
    expect(
      getServerCalendarDate(new Date("2026-06-11T02:30:00.000Z")),
    ).toBe("2026-06-11");
  });

  it("finds Monday week start", () => {
    expect(getWeekStartMonday("2026-06-11")).toBe("2026-06-08");
    expect(getWeekStartMonday("2026-06-15")).toBe("2026-06-15");
  });

  it("adds calendar days in server time", () => {
    expect(addCalendarDays("2026-06-11", 1)).toBe("2026-06-12");
  });

  it("builds a Monday-start month grid", () => {
    const grid = buildMonthGrid("2026-06");
    expect(grid).toHaveLength(42);
    expect(grid.filter((cell) => cell.inMonth)).toHaveLength(30);
    expect(grid[0]?.date).toBe("2026-06-01");
  });

  it("finds month end", () => {
    expect(monthEndFromKey("2026-06")).toBe("2026-06-30");
    expect(monthEndFromKey("2026-02")).toBe("2026-02-28");
  });
});

describe("vs_push_week template", () => {
  it("assigns mechanisms across the week", () => {
    const weekStart = "2026-06-08";
    const configs = generateWeekDayConfigs("vs_push_week", weekStart);
    expect(configs).toHaveLength(7);
    expect(configs[0]?.conductorMechanism).toBe("vs_high_score");
    expect(configs[1]?.conductorMechanism).toBe("vs_top_10");
    expect(configs[5]?.conductorMechanism).toBe("r4_sequence");
    expect(configs[5]?.vipMechanism).toBe("event_top_x_lottery");
    expect(configs[6]?.vipMechanism).toBe("event_top_x_lottery");
  });
});

describe("generateDayConfigForDate", () => {
  it("returns the Tuesday slot from vs_push_week", () => {
    const weekStart = "2026-06-08";
    const config = generateDayConfigForDate(
      "vs_push_week",
      "2026-06-09",
      weekStart,
    );
    expect(config.conductorMechanism).toBe("vs_top_10");
    expect(config.vipMechanism).toBe("conductor_pick");
  });

  it("returns economy day config for any weekday", () => {
    const weekStart = "2026-06-08";
    const config = generateDayConfigForDate(
      "economy_week",
      "2026-06-10",
      weekStart,
    );
    expect(config.conductorMechanism).toBe("r3_lottery");
  });
});

describe("supportsManualConductorPick", () => {
  it("allows manual override on leaderboard and pool days", () => {
    expect(supportsManualConductorPick("r3_lottery")).toBe(true);
    expect(supportsManualConductorPick("vs_high_score")).toBe(true);
    expect(supportsManualConductorPick("vs_top_10")).toBe(true);
    expect(supportsManualConductorPick("donations_top")).toBe(true);
    expect(supportsManualConductorPick("event_top_x_lottery")).toBe(false);
  });
});
