import { describe, expect, it } from "vitest";
import { expandPlan, occurrenceIsAway, parsePlanSchedule, parsePlanWeekdays, resolvePlanClock, normalizePlanClockTime } from "./schedule.shared";

const weekly = { kind: "weekly", date: "2026-01-01", days: [0, 2], start: "20:00", end: "21:00", endsNextDay: false, zone: "America/New_York" };

describe("Plunder Plan recurrence", () => {
  it("keeps local time through DST and orders/deduplicates weekdays", () => {
    const schedule = parsePlanSchedule({ ...weekly, days: [2, 0, 2] });
    expect(schedule.days).toEqual([0, 2]);
    const result = expandPlan(schedule, "2026-03-01T00:00:00Z", "2026-03-11T00:00:00Z");
    expect(result.occurrences.map((row) => row.startAt)).toEqual(["2026-03-02T01:00:00.000Z", "2026-03-04T01:00:00.000Z", "2026-03-09T00:00:00.000Z"]);
  });
  it("skips a spring gap instead of silently shifting it", () => {
    const result = expandPlan(parsePlanSchedule({ ...weekly, start: "02:30", end: "03:30" }), "2026-03-08T00:00:00Z", "2026-03-09T00:00:00Z");
    expect(result.occurrences).toEqual([]);
    expect(result.skippedDates).toEqual(["2026-03-08"]);
    expect(() => parsePlanSchedule({ ...weekly, kind: "once", date: "2026-03-08", start: "02:30", end: "03:30" })).toThrow("nonexistentTime");
  });
  it("uses the first repeated clock once", () => {
    expect(resolvePlanClock("2026-11-01", "01:30", "America/New_York")).toBe("2026-11-01T05:30:00.000Z");
    expect(expandPlan(parsePlanSchedule({ ...weekly, start: "01:30", end: "02:30" }), "2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z").occurrences).toHaveLength(1);
  });
  it("handles half-hour DST shifts and quarter-hour offsets", () => {
    expect(resolvePlanClock("2026-10-04", "02:15", "Australia/Lord_Howe")).toBeNull();
    expect(resolvePlanClock("2026-01-01", "10:00", "Asia/Kathmandu")).toBe("2026-01-01T04:15:00.000Z");
  });
  it("renders a one-time overnight occurrence exactly once across a year boundary", () => {
    const schedule = parsePlanSchedule({ ...weekly, kind: "once", date: "2026-12-31", zone: "Etc/GMT+2", start: "23:00", end: "01:00", endsNextDay: true });
    const result = expandPlan(schedule, "2027-01-01T02:00:00Z", "2027-01-02T02:00:00Z");
    expect(result.occurrences).toEqual([{ key: "2026-12-31", localDate: "2026-12-31", startAt: "2027-01-01T01:00:00.000Z", endAt: "2027-01-01T03:00:00.000Z" }]);
    expect(expandPlan(schedule, "2027-01-07T00:00:00Z", "2027-01-09T00:00:00Z").occurrences).toEqual([]);
  });
  it("checks all crossed game days but not an exclusive endpoint", () => {
    const absence = [{ startDate: "2026-09-10", endDate: "2026-09-10" }];
    expect(occurrenceIsAway({ startAt: "2026-09-10T01:00:00Z", endAt: "2026-09-10T03:00:00Z" }, absence)).toBe(true);
    expect(occurrenceIsAway({ startAt: "2026-09-10T01:00:00Z", endAt: "2026-09-10T02:00:00Z" }, absence)).toBe(false);
  });
  it.each([
    { date: "2026-02-30" }, { zone: "not-a-zone" }, { start: "25:00" }, { days: [] }, { days: [7] }, { end: "20:00" }, { end: "21:01", endsNextDay: true },
  ])("rejects invalid schedules %j", (patch) => {
    expect(() => parsePlanSchedule({ ...weekly, ...patch })).toThrow();
  });
  it("bounds range expansion and rejects inverted or invalid ranges", () => {
    const schedule = parsePlanSchedule(weekly);
    for (const [start, end] of [["2026-01-01", "2027-01-01"], ["2026-02-01", "2026-01-01"], ["bad", "bad"]]) expect(() => expandPlan(schedule, start, end)).toThrow("invalidSchedule");
  });
  it("strips seconds from HTML time values", () => {
    expect(normalizePlanClockTime("09:30:00")).toBe("09:30");
    expect(normalizePlanClockTime("09:30")).toBe("09:30");
    expect(normalizePlanClockTime("25:00")).toBeNull();
  });
  it("accepts numeric weekdays and locale leading tokens", () => {
    expect(parsePlanWeekdays("1, 3", "en-US")).toEqual([1, 3]);
    expect(parsePlanWeekdays("segunda", "pt-BR")).toEqual([1]);
    expect(parsePlanWeekdays("segunda-feira", "pt-BR")).toEqual([1]);
  });
});
