import { describe, expect, it } from "vitest";

import {
  coerceVsPerformanceRecordedDate,
  defaultVsPerformanceRecordedDate,
  isValidVsPerformanceRecordedDate,
  isVsWeeklyUploadWindow,
  listRecentVsPerformanceDates,
  nearestValidVsPerformanceDate,
  vsPerformanceDayMetaForDate,
  vsPerformanceDayNumberForDate,
} from "@/lib/video/vs-recorded-date.shared";

describe("vsPerformanceDayNumberForDate", () => {
  it("maps Mon–Sat to days 1–6 and rejects Sunday", () => {
    // 2026-07-06 Mon … 2026-07-12 Sun (server calendar UTC−2)
    expect(vsPerformanceDayNumberForDate("2026-07-06")).toBe(1);
    expect(vsPerformanceDayNumberForDate("2026-07-07")).toBe(2);
    expect(vsPerformanceDayNumberForDate("2026-07-08")).toBe(3);
    expect(vsPerformanceDayNumberForDate("2026-07-09")).toBe(4);
    expect(vsPerformanceDayNumberForDate("2026-07-10")).toBe(5);
    expect(vsPerformanceDayNumberForDate("2026-07-11")).toBe(6);
    expect(vsPerformanceDayNumberForDate("2026-07-12")).toBeNull();
  });
});

describe("isValidVsPerformanceRecordedDate", () => {
  it("daily rejects Sunday and accepts Saturday", () => {
    expect(isValidVsPerformanceRecordedDate("2026-07-12")).toBe(false);
    expect(isValidVsPerformanceRecordedDate("2026-07-11")).toBe(true);
  });

  it("weekly accepts Sunday only", () => {
    expect(isValidVsPerformanceRecordedDate("2026-07-12", "weekly")).toBe(true);
    expect(isValidVsPerformanceRecordedDate("2026-07-11", "weekly")).toBe(
      false,
    );
  });
});

describe("vsPerformanceDayMetaForDate", () => {
  it("returns upload-review day keys", () => {
    expect(vsPerformanceDayMetaForDate("2026-07-06")).toEqual({
      recordedDate: "2026-07-06",
      vsDayNumber: 1,
      vsDayKey: "radarTraining",
    });
    expect(vsPerformanceDayMetaForDate("2026-07-09")?.vsDayKey).toBe(
      "trainHeroes",
    );
    expect(vsPerformanceDayMetaForDate("2026-07-11")?.vsDayKey).toBe(
      "enemyBuster",
    );
  });
});

describe("nearestValidVsPerformanceDate", () => {
  it("steps back from Sunday to Saturday for daily", () => {
    expect(nearestValidVsPerformanceDate("2026-07-12")).toBe("2026-07-11");
  });

  it("steps back to Sunday for weekly", () => {
    expect(nearestValidVsPerformanceDate("2026-07-13", "weekly")).toBe(
      "2026-07-12",
    );
  });
});

describe("defaultVsPerformanceRecordedDate", () => {
  it("uses server Sunday for weekly during the Sun→Mon upload window", () => {
    // Saturday evening US / Sunday early server (UTC−2)
    const sundayServer = new Date("2026-07-19T03:30:00.000Z"); // Sun 01:30 ST
    expect(defaultVsPerformanceRecordedDate("weekly", sundayServer)).toBe(
      "2026-07-19",
    );
    expect(isVsWeeklyUploadWindow(sundayServer)).toBe(true);
  });

  it("does not snap weekly to last week when account-local would be Saturday", () => {
    // Bug reproduction: walking back from account Sat 2026-07-18 while server
    // is already Sun 2026-07-19 wrongly yielded 2026-07-12.
    expect(nearestValidVsPerformanceDate("2026-07-18", "weekly")).toBe(
      "2026-07-12",
    );
    const sundayServer = new Date("2026-07-19T03:30:00.000Z");
    expect(defaultVsPerformanceRecordedDate("weekly", sundayServer)).toBe(
      "2026-07-19",
    );
  });

  it("uses prior Sunday for weekly mid-week", () => {
    const wednesday = new Date("2026-07-15T14:00:00.000-02:00");
    expect(defaultVsPerformanceRecordedDate("weekly", wednesday)).toBe(
      "2026-07-12",
    );
    expect(isVsWeeklyUploadWindow(wednesday)).toBe(false);
  });

  it("defaults daily to prior valid VS day (yesterday when Mon–Sat)", () => {
    const wednesday = new Date("2026-07-15T14:00:00.000-02:00");
    expect(defaultVsPerformanceRecordedDate("daily", wednesday)).toBe(
      "2026-07-14",
    );
  });

  it("defaults daily to Saturday when server day is Sunday", () => {
    const sundayServer = new Date("2026-07-19T03:30:00.000Z");
    expect(defaultVsPerformanceRecordedDate("daily", sundayServer)).toBe(
      "2026-07-18",
    );
  });

  it("defaults daily to Saturday when server day is Monday (skips Sunday)", () => {
    const monday = new Date("2026-07-20T14:00:00.000-02:00");
    expect(defaultVsPerformanceRecordedDate("daily", monday)).toBe(
      "2026-07-18",
    );
  });
});

describe("coerceVsPerformanceRecordedDate", () => {
  it("preserves a valid weekly Sunday", () => {
    expect(coerceVsPerformanceRecordedDate("2026-07-05", "weekly")).toBe(
      "2026-07-05",
    );
  });

  it("defaults invalid weekly dates from server today, not account-local walk-back", () => {
    const sundayServer = new Date("2026-07-19T03:30:00.000Z");
    expect(
      coerceVsPerformanceRecordedDate("2026-07-18", "weekly", sundayServer),
    ).toBe("2026-07-19");
  });

  it("walks back invalid daily Sunday to Saturday", () => {
    expect(coerceVsPerformanceRecordedDate("2026-07-12", "daily")).toBe(
      "2026-07-11",
    );
  });
});

describe("listRecentVsPerformanceDates", () => {
  it("lists only Sundays for weekly period", () => {
    const dates = listRecentVsPerformanceDates({
      now: new Date("2026-07-15T12:00:00.000-02:00"),
      daysBack: 14,
      period: "weekly",
    });
    expect(dates.length).toBeGreaterThan(0);
    for (const date of dates) {
      expect(isValidVsPerformanceRecordedDate(date, "weekly")).toBe(true);
    }
    expect(dates).toContain("2026-07-12");
    expect(dates).toContain("2026-07-05");
  });
});
