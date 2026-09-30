import { describe, expect, it } from "vitest";

import {
  allianceTrainWeekFromRow,
  dayIndexInTrainWeek,
  DEFAULT_ALLIANCE_TRAIN_WEEK,
  getTrainWeekStart,
  scheduleWeekStart,
  weekDatesInTrainWeek,
} from "@/lib/trains/train-week-calendar.shared";
import { addCalendarDays } from "@/lib/trains/game-time";

describe("train week calendar (Tuesday start default)", () => {
  const config = DEFAULT_ALLIANCE_TRAIN_WEEK;

  it("defaults trainWeekStartDow to Tuesday", () => {
    expect(config.trainWeekStartDow).toBe(2);
  });

  it("finds Tuesday week start for dates in the same train week", () => {
    expect(getTrainWeekStart("2026-06-09", config)).toBe("2026-06-09");
    expect(getTrainWeekStart("2026-06-11", config)).toBe("2026-06-09");
    expect(getTrainWeekStart("2026-06-15", config)).toBe("2026-06-09");
  });

  it("rolls back to prior Tuesday when date is Monday", () => {
    expect(getTrainWeekStart("2026-06-08", config)).toBe("2026-06-02");
    expect(getTrainWeekStart("2026-06-15", config)).toBe("2026-06-09");
  });

  it("lists seven dates from Tuesday through Monday", () => {
    expect(weekDatesInTrainWeek("2026-06-09", config)).toEqual([
      "2026-06-09",
      "2026-06-10",
      "2026-06-11",
      "2026-06-12",
      "2026-06-13",
      "2026-06-14",
      "2026-06-15",
    ]);
  });

  it("maps train week indices Tue=0 through Mon=6", () => {
    const weekStart = "2026-06-09";
    expect(dayIndexInTrainWeek("2026-06-09", weekStart, config)).toBe(0);
    expect(dayIndexInTrainWeek("2026-06-10", weekStart, config)).toBe(1);
    expect(dayIndexInTrainWeek("2026-06-13", weekStart, config)).toBe(4);
    expect(dayIndexInTrainWeek("2026-06-14", weekStart, config)).toBe(5);
    expect(dayIndexInTrainWeek("2026-06-15", weekStart, config)).toBe(6);
    expect(dayIndexInTrainWeek("2026-06-08", weekStart, config)).toBe(-1);
  });

  it("reads alliance row config with Tuesday fallback", () => {
    expect(allianceTrainWeekFromRow({ trainWeekStartDow: 4 })).toEqual({
      trainWeekStartDow: 4,
    });
    expect(allianceTrainWeekFromRow({ trainWeekStartDow: null })).toEqual(
      DEFAULT_ALLIANCE_TRAIN_WEEK,
    );
    expect(allianceTrainWeekFromRow({})).toEqual(DEFAULT_ALLIANCE_TRAIN_WEEK);
  });
});

describe("scheduleWeekStart", () => {
  it("collapses every day of a calendar week onto its Monday", () => {
    // 2026-06-08 is a Monday.
    for (let offset = 0; offset < 7; offset += 1) {
      const date = addCalendarDays("2026-06-08", offset);
      expect(scheduleWeekStart(date), date).toBe("2026-06-08");
    }
  });

  it("keys a date to the same row whatever the display preference", () => {
    // The invariant is per *date*, not per display week start: changing
    // trainWeekStartDow must not move which schedule row a date belongs to.
    for (const dow of [0, 1, 2, 3, 4, 5, 6]) {
      const displayWeek = weekDatesInTrainWeek("2026-06-10", {
        trainWeekStartDow: dow,
      });
      for (const date of displayWeek) {
        expect(scheduleWeekStart(date), `${dow}:${date}`).toBe(
          scheduleWeekStart(date),
        );
      }
      expect(displayWeek).toContain("2026-06-10");
    }
  });

  it("splits a display week that straddles two Monday weeks", () => {
    // A Sunday-start alliance's week spans two schedule rows, so day fill
    // must resolve per date rather than from one week's template.
    const sundayStartWeek = weekDatesInTrainWeek("2026-06-10", {
      trainWeekStartDow: 0,
    });
    const mondays = new Set(sundayStartWeek.map(scheduleWeekStart));
    expect(mondays.size).toBe(2);
  });

  it("is injective across adjacent weeks", () => {
    expect(scheduleWeekStart("2026-06-07")).toBe("2026-06-01");
    expect(scheduleWeekStart("2026-06-08")).toBe("2026-06-08");
    expect(scheduleWeekStart("2026-06-15")).toBe("2026-06-15");
  });
});
