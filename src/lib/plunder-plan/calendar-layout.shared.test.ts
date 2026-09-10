import { describe, expect, it } from "vitest";
import { calendarDayBounds, calendarGroups, calendarSegments, swipeDayDelta } from "./calendar-layout.shared";
import { colorLuminance, defaultPlanColor, parsePlanColor, PLAN_PALETTE, planColorStyle } from "./colors.shared";

describe("Plunder Plan calendar density", () => {
  it("keeps all 100 overlapping events reachable with bounded lanes", () => {
    const events = Array.from({ length: 100 }, (_, i) => ({ id: `event-${i}`, startAt: "2026-09-10T12:00:00Z", endAt: "2026-09-10T13:00:00Z" }));
    const groups = calendarGroups(calendarSegments(events, "2026-09-10", "UTC"), 3);
    expect(groups).toHaveLength(1);
    expect(groups[0].lanes).toBe(3);
    expect(groups[0].visible).toHaveLength(3);
    expect(groups[0].overflow).toHaveLength(97);
    expect(new Set([...groups[0].visible, ...groups[0].overflow].map((row) => row.event.id)).size).toBe(100);
    expect(calendarGroups(calendarSegments([...events].reverse(), "2026-09-10", "UTC"))).toEqual(groups);
  });
  it("clips overnight events without duplicating their identity", () => {
    const event = { id: "overnight", startAt: "2026-09-10T23:00:00Z", endAt: "2026-09-11T01:00:00Z" };
    expect(calendarSegments([event], "2026-09-10", "UTC")[0]).toMatchObject({ startMinute: 1380, endMinute: 1440, continuesAfter: true });
    expect(calendarSegments([event], "2026-09-11", "UTC")[0]).toMatchObject({ event, startMinute: 0, endMinute: 60, continuesBefore: true });
  });
  it("uses actual elapsed minutes on short and long DST days", () => {
    expect(calendarDayBounds("2026-03-08", "America/New_York")?.minutes).toBe(1380);
    expect(calendarDayBounds("2026-11-01", "America/New_York")?.minutes).toBe(1500);
    const rows = calendarSegments([{ id: "fold", startAt: "2026-11-01T05:30:00Z", endAt: "2026-11-01T06:15:00Z" }], "2026-11-01", "America/New_York");
    expect(rows[0].endMinute - rows[0].startMinute).toBe(45);
  });
  it("handles a day whose midnight is skipped", () => {
    expect(calendarDayBounds("2026-09-06", "America/Santiago")?.minutes).toBe(1380);
  });
  it("does not treat adjacent intervals as overlaps", () => {
    const events = [{ id: "a", startAt: "2026-09-10T12:00:00Z", endAt: "2026-09-10T13:00:00Z" }, { id: "b", startAt: "2026-09-10T13:00:00Z", endAt: "2026-09-10T14:00:00Z" }];
    expect(calendarGroups(calendarSegments(events, "2026-09-10", "UTC"))).toHaveLength(2);
  });
  it("separates horizontal navigation from vertical scrolling and taps", () => {
    const start = { x: 100, y: 100 };
    expect(swipeDayDelta(start, { x: 20, y: 110 })).toBe(1);
    expect(swipeDayDelta(start, { x: 180, y: 110 })).toBe(-1);
    expect(swipeDayDelta(start, { x: 120, y: 200 })).toBe(0);
    expect(swipeDayDelta(start, { x: 103, y: 102 })).toBe(0);
  });
});

describe("personal calendar colors", () => {
  it("validates palette or strict hex values only", () => {
    expect(parsePlanColor("teal")).toBe(PLAN_PALETTE.teal);
    expect(parsePlanColor("#abcdef")).toBe("#ABCDEF");
    for (const color of ["red;display:none", "#fff", "#ffffff00", "url(example)", "__proto__", null]) expect(parsePlanColor(color)).toBeNull();
  });
  it("uses readable foregrounds across palette and custom colors", () => {
    for (const color of [...Object.values(PLAN_PALETTE), "#000000", "#FFFFFF", "#777777", "#FF00FF", "#00FF00"]) {
      const style = planColorStyle(color);
      const a = colorLuminance(style.color), b = colorLuminance(style.backgroundColor);
      expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("provides a stable person default and allows shared colors", () => {
    expect(defaultPlanColor("hq:person")).toBe(defaultPlanColor("hq:person"));
    expect(Object.values(PLAN_PALETTE)).toContain(defaultPlanColor("discord:person"));
  });
});
