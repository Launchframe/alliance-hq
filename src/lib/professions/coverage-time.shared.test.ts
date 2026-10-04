import { describe, expect, it } from "vitest";

import {
  configuredShiftOccurrences,
  daysSince,
  displayHourToUtcHour,
  formatCoverageHourLabel,
  utcHourToDisplayHour,
} from "@/lib/professions/coverage-time.shared";

describe("configured Engineer occurrences", () => {
  const window = { coverageStartHour: 22, coverageEndHour: 4, assignedAt: new Date("2026-01-01T00:00:00Z") };
  it("enumerates future configured overnight shifts on every overlapping server date", () => {
    const shifts = configuredShiftOccurrences(window, "2026-09-10", "2026-09-12");
    expect(shifts.map((shift) => shift.dutyDate)).toEqual(["2026-09-10", "2026-09-10", "2026-09-11", "2026-09-11", "2026-09-12", "2026-09-12"]);
    expect(shifts[0]).toMatchObject({ dutyStartAt: "2026-09-09T22:00:00.000Z", dutyEndAt: "2026-09-10T04:00:00.000Z" });
    expect(shifts.at(-1)).toMatchObject({ dutyStartAt: "2026-09-12T22:00:00.000Z", dutyEndAt: "2026-09-13T04:00:00.000Z" });
  });
  it("excludes exact end boundaries and includes UTC next-day shifts before server midnight", () => {
    const shifts = configuredShiftOccurrences({ ...window, coverageStartHour: 0, coverageEndHour: 2 }, "2026-09-10", "2026-09-10");
    expect(shifts).toHaveLength(1);
    expect(shifts[0]).toMatchObject({ dutyDate: "2026-09-10", dutyStartAt: "2026-09-11T00:00:00.000Z", dutyEndAt: "2026-09-11T02:00:00.000Z" });
  });
  it("does not invent duties for permanent pairings, empty windows, or before assignment", () => {
    for (const change of [{ coverageStartHour: null }, { coverageEndHour: null }, { coverageEndHour: 22 }, { assignedAt: new Date("2026-09-14T00:00:00Z") }]) {
      expect(configuredShiftOccurrences({ ...window, ...change }, "2026-09-10", "2026-09-12")).toEqual([]);
    }
  });
  it("bounds enumeration and includes only the requested date at both overlap edges", () => {
    expect(configuredShiftOccurrences(window, "2026-09-10", "2028-09-10")).toEqual([]);
    const shifts = configuredShiftOccurrences(window, "2026-09-10", "2026-09-10");
    expect(shifts).toHaveLength(2);
    expect(shifts.every((shift) => shift.dutyDate === "2026-09-10")).toBe(true);
  });
});

describe("coverage-time.shared", () => {
  it("round-trips UTC hours through server display zone", () => {
    for (let utcHour = 0; utcHour < 24; utcHour += 1) {
      const display = utcHourToDisplayHour(utcHour, "server");
      const back = displayHourToUtcHour(display, "server");
      expect(back).toBe(utcHour);
    }
  });

  it("formats coverage hour labels", () => {
    expect(formatCoverageHourLabel(0, "server")).toMatch(/\d.* ST$/);
    expect(formatCoverageHourLabel(12, "local")).toMatch(/\d.* (Local \(.+\)|ST)$/);
  });

  it("daysSince returns null for invalid input", () => {
    expect(daysSince(null)).toBeNull();
    expect(daysSince("not-a-date")).toBeNull();
  });

  it("daysSince counts whole days since ISO timestamp", () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(daysSince(twoDaysAgo)).toBeGreaterThanOrEqual(1);
  });
});
