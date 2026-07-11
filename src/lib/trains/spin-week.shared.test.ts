import { describe, expect, it } from "vitest";

import {
  canSpinConductorWeek,
  showsConductorSpinWheel,
  spinWheelDatesForRestOfWeek,
} from "@/lib/trains/spin-week.shared";

describe("showsConductorSpinWheel", () => {
  it("includes vs_top_10 and r3_lottery when unlocked", () => {
    expect(showsConductorSpinWheel("vs_top_10", false, "vs_push_weekdays")).toBe(
      true,
    );
    expect(showsConductorSpinWheel("r3_lottery", false, "economy_week")).toBe(
      true,
    );
  });

  it("excludes r4 sequence assign days", () => {
    expect(showsConductorSpinWheel("r4_sequence", false, null)).toBe(false);
    expect(
      showsConductorSpinWheel("officer_pick", false, "r4_event_vip"),
    ).toBe(false);
  });

  it("excludes locked days and leaderboard auto-pick mechanisms", () => {
    expect(showsConductorSpinWheel("vs_top_10", true, null)).toBe(false);
    expect(showsConductorSpinWheel("vs_high_score", false, null)).toBe(false);
    expect(showsConductorSpinWheel("donations_top", false, null)).toBe(false);
  });

  it("includes Saturday price_is_right when stored as r3_lottery (date-dependent remap)", () => {
    expect(
      showsConductorSpinWheel(
        "r3_lottery",
        false,
        "price_is_right",
        "2026-06-13",
      ),
    ).toBe(true);
    expect(
      showsConductorSpinWheel(
        "r3_lottery",
        false,
        "price_is_right",
        "2026-06-12",
      ),
    ).toBe(true);
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
            conductorMechanism: "vs_top_10",
            paintTemplate: "vs_push_weekdays",
          },
          {
            date: "2026-06-11",
            conductorMechanism: "vs_top_10",
            paintTemplate: "vs_push_weekdays",
          },
          {
            date: "2026-06-12",
            conductorMechanism: "r4_sequence",
            paintTemplate: null,
          },
          {
            date: "2026-06-13",
            conductorMechanism: "r3_lottery",
            paintTemplate: "economy_week",
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
            conductorMechanism: "vs_top_10",
            paintTemplate: "vs_push_weekdays",
          },
          {
            date: "2026-06-11",
            conductorMechanism: "vs_top_10",
            paintTemplate: "vs_push_weekdays",
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
            conductorMechanism: "r3_lottery",
            paintTemplate: "price_is_right",
          },
        ],
        weekRecords: [],
      }),
    ).toEqual(["2026-06-13"]);
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
