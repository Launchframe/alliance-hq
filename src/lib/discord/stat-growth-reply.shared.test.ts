import { describe, expect, it } from "vitest";

import {
  computeGrowthWindow,
  formatKillsPerHour,
  resolveStatGrowth,
} from "@/lib/discord/stat-growth-reply.shared";

describe("computeGrowthWindow", () => {
  it("returns null for non-positive elapsed time", () => {
    const at = new Date("2026-07-11T12:00:00Z");
    expect(computeGrowthWindow(at, at)).toBeNull();
    expect(computeGrowthWindow(at, new Date("2026-07-11T11:00:00Z"))).toBeNull();
  });

  it("prefers hours under 48h", () => {
    const previousAt = new Date("2026-07-11T00:00:00Z");
    const now = new Date("2026-07-11T12:00:00Z");
    expect(computeGrowthWindow(previousAt, now)).toEqual({
      hours: 12,
      days: 1,
      preferHours: true,
    });
  });

  it("prefers days at 48h or more", () => {
    const previousAt = new Date("2026-07-09T12:00:00Z");
    const now = new Date("2026-07-11T12:00:00Z");
    expect(computeGrowthWindow(previousAt, now)).toEqual({
      hours: 48,
      days: 2,
      preferHours: false,
    });
  });
});

describe("formatKillsPerHour", () => {
  it("returns zero for non-positive inputs", () => {
    expect(formatKillsPerHour(0, 5)).toBe("0");
    expect(formatKillsPerHour(100, 0)).toBe("0");
  });

  it("formats large rates without decimals", () => {
    expect(formatKillsPerHour(50_000, 10)).toBe("5,000");
  });
});

describe("resolveStatGrowth", () => {
  const now = new Date("2026-07-11T12:00:00Z");
  const previousAt = new Date("2026-07-11T00:00:00Z");

  it("returns null growth for first report", () => {
    expect(
      resolveStatGrowth({
        commanderName: "Alpha",
        total: 10_000,
        previousTotal: null,
        previousAt: null,
        now,
      }),
    ).toEqual({ delta: null, window: null, hoursForRate: null });
  });

  it("returns null growth when total did not increase", () => {
    expect(
      resolveStatGrowth({
        commanderName: "Alpha",
        total: 10_000,
        previousTotal: 10_000,
        previousAt,
        now,
      }),
    ).toEqual({ delta: null, window: null, hoursForRate: null });
  });

  it("computes delta and window when prior report increased", () => {
    const growth = resolveStatGrowth({
      commanderName: "Alpha",
      total: 12_000,
      previousTotal: 10_000,
      previousAt,
      now,
    });
    expect(growth.delta).toBe(2000);
    expect(growth.window).toEqual({
      hours: 12,
      days: 1,
      preferHours: true,
    });
    expect(growth.hoursForRate).toBe(12);
  });

  it("returns delta without window when previousAt is missing", () => {
    const growth = resolveStatGrowth({
      commanderName: "Alpha",
      total: 12_000,
      previousTotal: 10_000,
      previousAt: null,
      now,
    });
    expect(growth.delta).toBe(2000);
    expect(growth.window).toBeNull();
    expect(growth.hoursForRate).toBeNull();
  });
});
