import { describe, expect, it } from "vitest";

import {
  isValidVsPerformanceRecordedDate,
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
