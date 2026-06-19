import { describe, expect, it } from "vitest";

import {
  formatServerCalendarDate,
  getServerCalendarDate,
} from "@/lib/trains/game-time";

describe("getServerCalendarDate", () => {
  it("uses UTC-2 server calendar, not host local date", () => {
    // 2026-01-01 01:30 UTC = 2025-12-31 23:30 UTC-2
    const lateUtcNewYears = new Date("2026-01-01T01:30:00.000Z");
    expect(formatServerCalendarDate(lateUtcNewYears)).toBe("2025-12-31");
    expect(getServerCalendarDate(lateUtcNewYears).slice(0, 4)).toBe("2025");
  });
});
