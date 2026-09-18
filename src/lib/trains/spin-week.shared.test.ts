import { describe, expect, it } from "vitest";

import {
  canSpinConductorWeek,
  showsConductorSpinWheel,
  spinWheelDatesForRestOfWeek,
  spinWheelDatesFromList,
  type SpinWeekDayConfig,
} from "@/lib/trains/spin-week.shared";

describe("showsConductorSpinWheel", () => {
  it("includes score boards and pool lotteries when unlocked", () => {
    expect(
      showsConductorSpinWheel({ kind: "vs_top_n", topN: 10 }, false),
    ).toBe(true);
    expect(
      showsConductorSpinWheel(
        { kind: "rank_pool", pool: "r3", draw: "wheel" },
        false,
      ),
    ).toBe(true);
    expect(
      showsConductorSpinWheel(
        { kind: "price_is_freight", board: "weekday" },
        false,
      ),
    ).toBe(true);
    expect(
      showsConductorSpinWheel(
        { kind: "price_is_freight", board: "heavy_hitter" },
        false,
      ),
    ).toBe(true);
  });

  it("excludes R4 rotation assign days", () => {
    expect(
      showsConductorSpinWheel(
        { kind: "rank_pool", pool: "r4_plus", draw: "wheel" },
        false,
      ),
    ).toBe(false);
  });

  it("excludes locked days and automatic boards", () => {
    expect(
      showsConductorSpinWheel({ kind: "vs_top_n", topN: 10 }, true),
    ).toBe(false);
    expect(showsConductorSpinWheel({ kind: "vs_top_n", topN: 1 }, false)).toBe(
      false,
    );
    expect(showsConductorSpinWheel({ kind: "donations_top" }, false)).toBe(
      false,
    );
  });

  it("excludes free choice and the manual R3 award", () => {
    expect(showsConductorSpinWheel(null, false)).toBe(false);
    expect(
      showsConductorSpinWheel(
        { kind: "rank_pool", pool: "r3", draw: "manual" },
        false,
      ),
    ).toBe(false);
  });
});

describe("spinWheelDatesForRestOfWeek", () => {
  const weekStart = "2026-06-08";
  const weekEnd = "2026-06-14";

  it("returns remaining wheel days from today through Sunday", () => {
    expect(
      spinWheelDatesForRestOfWeek({
        today: "2026-06-10",
        weekStart,
        weekEnd,
        dayConfigs: [
          {
            date: "2026-06-10",
            conductorRule: { kind: "vs_top_n", topN: 10 },
          },
          {
            date: "2026-06-11",
            conductorRule: { kind: "vs_top_n", topN: 10 },
          },
          {
            date: "2026-06-12",
            conductorRule: { kind: "rank_pool", pool: "r4_plus", draw: "wheel" },
          },
          {
            date: "2026-06-13",
            conductorRule: { kind: "rank_pool", pool: "r3", draw: "wheel" },
          },
        ],
        weekRecords: [],
      }),
    ).toEqual(["2026-06-10", "2026-06-11", "2026-06-13"]);
  });

  it("skips days before today and locked days", () => {
    expect(
      spinWheelDatesForRestOfWeek({
        today: "2026-06-11",
        weekStart,
        weekEnd,
        dayConfigs: [
          {
            date: "2026-06-10",
            conductorRule: { kind: "vs_top_n", topN: 10 },
          },
          {
            date: "2026-06-11",
            conductorRule: { kind: "vs_top_n", topN: 10 },
          },
        ],
        weekRecords: [
          { date: "2026-06-11", lockedAt: "2026-06-11T12:00:00.000Z" },
        ],
      }),
    ).toEqual([]);
  });

  it("includes Saturday price_is_right heavy-hitter days stored as r3_lottery", () => {
    expect(
      spinWheelDatesForRestOfWeek({
        today: "2026-06-13",
        weekStart,
        weekEnd,
        dayConfigs: [
          {
            date: "2026-06-13",
            conductorRule: { kind: "rank_pool", pool: "r3", draw: "wheel" },
          },
        ],
        weekRecords: [],
      }),
    ).toEqual(["2026-06-13"]);
  });
});

describe("spinWheelDatesFromList", () => {
  const dayConfigs: SpinWeekDayConfig[] = [
    { date: "2026-06-10", conductorRule: { kind: "vs_top_n", topN: 10 } },
    { date: "2026-06-11", conductorRule: { kind: "vs_top_n", topN: 10 } },
    {
      date: "2026-06-12",
      conductorRule: { kind: "rank_pool", pool: "r4_plus", draw: "wheel" },
    },
  ];

  it("skips past dates, locked days, and days that already have a conductor", () => {
    expect(
      spinWheelDatesFromList({
        today: "2026-06-11",
        dates: ["2026-06-10", "2026-06-11", "2026-06-12"],
        dayConfigs,
        weekRecords: [
          { date: "2026-06-11", conductorMemberId: "member-1" },
        ],
      }),
    ).toEqual([]);
  });

  it("returns wheel-eligible future dates from the explicit selection", () => {
    expect(
      spinWheelDatesFromList({
        today: "2026-06-10",
        dates: ["2026-06-10", "2026-06-11", "2026-06-12"],
        dayConfigs,
        weekRecords: [],
      }),
    ).toEqual(["2026-06-10", "2026-06-11"]);
  });
});

describe("canSpinConductorWeek", () => {
  it("is true for the current and future weeks", () => {
    expect(canSpinConductorWeek("2026-06-14", "2026-06-10")).toBe(true);
    expect(canSpinConductorWeek("2026-06-21", "2026-06-10")).toBe(true);
  });

  it("is false for weeks that ended before today", () => {
    expect(canSpinConductorWeek("2026-06-07", "2026-06-10")).toBe(false);
  });
});
