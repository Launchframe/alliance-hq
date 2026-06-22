import { describe, expect, it } from "vitest";

import { DEFAULT_ALLIANCE_TRAIN_WEEK } from "@/lib/trains/train-week-calendar.shared";
import {
  defaultIncludeTodayForWeekTemplateChange,
  latestLockedDateInWeek,
  pivotEconomyTargetDates,
  restOfWeekPaintDates,
} from "@/lib/trains/week-template-change.shared";

describe("latestLockedDateInWeek", () => {
  const weekStart = "2026-06-08";
  const weekEnd = "2026-06-14";

  it("returns null when nothing is locked", () => {
    expect(
      latestLockedDateInWeek(
        [{ date: "2026-06-09", lockedAt: null }],
        weekStart,
        weekEnd,
      ),
    ).toBeNull();
  });

  it("returns the latest locked calendar day in the week", () => {
    expect(
      latestLockedDateInWeek(
        [
          { date: "2026-06-09", lockedAt: "2026-06-09T12:00:00.000Z" },
          { date: "2026-06-11", lockedAt: "2026-06-11T12:00:00.000Z" },
        ],
        weekStart,
        weekEnd,
      ),
    ).toBe("2026-06-11");
  });

  it("ignores locks outside the week", () => {
    expect(
      latestLockedDateInWeek(
        [{ date: "2026-06-15", lockedAt: "2026-06-15T12:00:00.000Z" }],
        weekStart,
        weekEnd,
      ),
    ).toBeNull();
  });
});

describe("pivotEconomyTargetDates", () => {
  it("returns Tue through Sun for a Mon-start week", () => {
    expect(
      pivotEconomyTargetDates("2026-06-08", "2026-06-14", {
        trainWeekStartDow: 1,
      }),
    ).toEqual([
      "2026-06-09",
      "2026-06-10",
      "2026-06-11",
      "2026-06-12",
      "2026-06-13",
      "2026-06-14",
    ]);
  });

  it("returns Tue through Sun for a Tue-start train week", () => {
    expect(
      pivotEconomyTargetDates("2026-06-16", "2026-06-22", DEFAULT_ALLIANCE_TRAIN_WEEK),
    ).toEqual([
      "2026-06-16",
      "2026-06-17",
      "2026-06-18",
      "2026-06-19",
      "2026-06-20",
      "2026-06-21",
    ]);
  });
});

describe("defaultIncludeTodayForWeekTemplateChange", () => {
  it("defaults true on the closing Monday of a Tue-start week", () => {
    expect(
      defaultIncludeTodayForWeekTemplateChange({
        weekStart: "2026-06-16",
        weekEnd: "2026-06-22",
        today: "2026-06-22",
      }),
    ).toBe(true);
  });

  it("defaults false mid-week", () => {
    expect(
      defaultIncludeTodayForWeekTemplateChange({
        weekStart: "2026-06-16",
        weekEnd: "2026-06-22",
        today: "2026-06-18",
      }),
    ).toBe(false);
  });
});

describe("restOfWeekPaintDates", () => {
  const weekStart = "2026-06-08";
  const weekEnd = "2026-06-14";

  it("starts tomorrow when includeToday is false", () => {
    expect(
      restOfWeekPaintDates({
        weekStart,
        weekEnd,
        today: "2026-06-10",
        includeToday: false,
        lockedThroughDate: null,
      }),
    ).toEqual(["2026-06-11", "2026-06-12", "2026-06-13", "2026-06-14"]);
  });

  it("includes today when includeToday is true", () => {
    expect(
      restOfWeekPaintDates({
        weekStart,
        weekEnd,
        today: "2026-06-10",
        includeToday: true,
        lockedThroughDate: null,
      }),
    ).toEqual([
      "2026-06-10",
      "2026-06-11",
      "2026-06-12",
      "2026-06-13",
      "2026-06-14",
    ]);
  });

  it("skips locked days and starts after lockedThroughDate", () => {
    expect(
      restOfWeekPaintDates({
        weekStart,
        weekEnd,
        today: "2026-06-09",
        includeToday: true,
        lockedThroughDate: "2026-06-10",
      }),
    ).toEqual(["2026-06-11", "2026-06-12", "2026-06-13", "2026-06-14"]);
  });

  it("returns empty when all remaining days are locked or past week end", () => {
    expect(
      restOfWeekPaintDates({
        weekStart,
        weekEnd,
        today: "2026-06-14",
        includeToday: false,
        lockedThroughDate: "2026-06-14",
      }),
    ).toEqual([]);
  });

  it("includes closing Monday when includeToday is true on a Tue-start week", () => {
    expect(
      restOfWeekPaintDates({
        weekStart: "2026-06-16",
        weekEnd: "2026-06-22",
        today: "2026-06-22",
        includeToday: true,
        lockedThroughDate: null,
        trainWeekConfig: DEFAULT_ALLIANCE_TRAIN_WEEK,
      }),
    ).toEqual(["2026-06-22"]);
  });
});
