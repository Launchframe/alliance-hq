import { describe, expect, it } from "vitest";

import {
  daysSince,
  displayHourToUtcHour,
  formatCoverageHourLabel,
  utcHourToDisplayHour,
} from "@/lib/professions/coverage-time.shared";

describe("coverage-time.shared", () => {
  it("round-trips UTC hours through server display zone", () => {
    for (let utcHour = 0; utcHour < 24; utcHour += 1) {
      const display = utcHourToDisplayHour(utcHour, "server");
      const back = displayHourToUtcHour(display, "server");
      expect(back).toBe(utcHour);
    }
  });

  it("formats coverage hour labels", () => {
    expect(formatCoverageHourLabel(0, "server")).toMatch(/\d/);
    expect(formatCoverageHourLabel(12, "local")).toMatch(/\d/);
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
