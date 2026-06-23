import { describe, expect, it } from "vitest";

import {
  addCalendarDays,
  buildMonthGrid,
  getServerCalendarDate,
  getWeekStartMonday,
  monthEndFromKey,
} from "@/lib/trains/game-time";
import { generateDayConfigForDate, generateWeekDayConfigs, supportsManualConductorPick, supportsManualVipPick } from "@/lib/trains/templates";

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

  it("builds a Tuesday-start month grid when displayWeekStartDow is 2", () => {
    const grid = buildMonthGrid("2026-06", 2);
    expect(grid[0]?.date).toBe("2026-05-26");
    expect(grid.find((cell) => cell.date === "2026-06-01")?.inMonth).toBe(true);
  });

  it("finds month end", () => {
    expect(monthEndFromKey("2026-06")).toBe("2026-06-30");
    expect(monthEndFromKey("2026-02")).toBe("2026-02-28");
  });
});

describe("vs_push_week template", () => {
  it("assigns mechanisms across the week via composite segments", () => {
    const weekStart = "2026-06-09";
    const configs = generateWeekDayConfigs("vs_push_week", weekStart);
    expect(configs).toHaveLength(7);
    expect(configs[0]?.date).toBe("2026-06-09");
    expect(configs[0]?.conductorMechanism).toBe("vs_high_score");
    expect(configs[1]?.conductorMechanism).toBe("vs_top_10");
    expect(configs[1]?.vipMechanism).toBe("conductor_pick");
    expect(configs[2]?.conductorMechanism).toBe("vs_top_10");
    expect(configs[3]?.conductorMechanism).toBe("vs_top_10");
    expect(configs[4]?.conductorMechanism).toBe("vs_top_10");
    expect(configs[4]?.vipMechanism).toBe("conductor_pick");
    expect(configs[5]?.conductorMechanism).toBe("r4_sequence");
    expect(configs[5]?.vipMechanism).toBe("event_top_x_lottery");
    expect(configs[6]?.date).toBe("2026-06-15");
    expect(configs[6]?.conductorMechanism).toBe("r4_sequence");
    expect(configs[6]?.vipMechanism).toBe("event_top_x_lottery");
  });
});

describe("r4_event_vip segment", () => {
  it("uses R4 conductor and event VIP lottery", () => {
    const config = generateDayConfigForDate(
      "r4_event_vip",
      "2026-06-13",
      "2026-06-09",
    );
    expect(config.conductorMechanism).toBe("r4_sequence");
    expect(config.vipMechanism).toBe("event_top_x_lottery");
  });
});

describe("generateDayConfigForDate", () => {
  it("does not recurse when weekStart is a Monday grid anchor on a Tuesday-start train week", () => {
    const date = "2026-06-10";
    const mondayWeekStart = getWeekStartMonday(date);
    expect(mondayWeekStart).toBe("2026-06-08");
    expect(() =>
      generateDayConfigForDate("vs_push_week", date, mondayWeekStart),
    ).not.toThrow();
    const config = generateDayConfigForDate(
      "vs_push_week",
      date,
      mondayWeekStart,
    );
    expect(config.conductorMechanism).toBe("custom");
  });

  it("returns the Tuesday slot from vs_push_week", () => {
    const weekStart = "2026-06-09";
    const config = generateDayConfigForDate(
      "vs_push_week",
      "2026-06-09",
      weekStart,
    );
    expect(config.conductorMechanism).toBe("vs_high_score");
    expect(config.vipMechanism).toBe("conductor_pick");
  });

  it("returns economy day config for any weekday", () => {
    const weekStart = "2026-06-09";
    const config = generateDayConfigForDate(
      "economy_week",
      "2026-06-10",
      weekStart,
    );
    expect(config.conductorMechanism).toBe("r3_lottery");
  });

  it("returns r3 lottery for every r3_recognition weekday (wheel, not vs auto-roll)", () => {
    const weekStart = "2026-06-09";
    for (const date of [
      "2026-06-09",
      "2026-06-10",
      "2026-06-11",
      "2026-06-12",
      "2026-06-13",
    ]) {
      const config = generateDayConfigForDate("r3_recognition", date, weekStart);
      expect(config.conductorMechanism).toBe("r3_lottery");
    }
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

describe("supportsManualVipPick", () => {
  it("allows manual override on lottery VIP days", () => {
    expect(supportsManualVipPick("event_top_x_lottery")).toBe(true);
    expect(supportsManualVipPick("donations_second")).toBe(true);
    expect(supportsManualVipPick("conductor_pick")).toBe(false);
    expect(supportsManualVipPick("none")).toBe(false);
  });
});
