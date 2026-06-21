import { describe, expect, it } from "vitest";

import {
  buildMonthGrid,
  DEFAULT_TRAINS_DISPLAY_WEEK_START_DOW,
  normalizeDisplayWeekStartDow,
  TRAINS_DISPLAY_WEEK_STARTS,
} from "@/lib/trains/trains-display-calendar.shared";

describe("normalizeDisplayWeekStartDow", () => {
  it("accepts Sunday and Monday", () => {
    expect(normalizeDisplayWeekStartDow(0)).toBe(TRAINS_DISPLAY_WEEK_STARTS.sunday);
    expect(normalizeDisplayWeekStartDow(1)).toBe(TRAINS_DISPLAY_WEEK_STARTS.monday);
  });

  it("falls back to the default for invalid values", () => {
    expect(normalizeDisplayWeekStartDow(null)).toBe(
      DEFAULT_TRAINS_DISPLAY_WEEK_START_DOW,
    );
    expect(normalizeDisplayWeekStartDow(2)).toBe(
      DEFAULT_TRAINS_DISPLAY_WEEK_START_DOW,
    );
    expect(normalizeDisplayWeekStartDow("monday")).toBe(
      DEFAULT_TRAINS_DISPLAY_WEEK_START_DOW,
    );
  });
});

describe("buildMonthGrid", () => {
  it("returns 42 cells with in-month flags for June 2026", () => {
    const grid = buildMonthGrid("2026-06");
    expect(grid).toHaveLength(42);
    expect(grid.filter((cell) => cell.inMonth)).toHaveLength(30);
    expect(grid.some((cell) => cell.date === "2026-06-01" && cell.inMonth)).toBe(
      true,
    );
    expect(grid.some((cell) => cell.date === "2026-05-31" && !cell.inMonth)).toBe(
      true,
    );
  });

  it("anchors Sunday-start grids on the preceding Sunday", () => {
    const grid = buildMonthGrid("2026-06", TRAINS_DISPLAY_WEEK_STARTS.sunday);
    expect(grid[0]?.date).toBe("2026-05-31");
    expect(grid[1]?.date).toBe("2026-06-01");
  });

  it("anchors Monday-start grids on the preceding Monday", () => {
    const grid = buildMonthGrid("2026-04", TRAINS_DISPLAY_WEEK_STARTS.monday);
    expect(grid[0]?.date).toBe("2026-03-30");
    expect(grid[2]?.date).toBe("2026-04-01");
  });
});
