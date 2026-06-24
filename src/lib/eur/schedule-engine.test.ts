import { describe, expect, it } from "vitest";

import {
  computeNextIntervalOccurrence,
  computeWeeklyOccurrencesInWindow,
  reminderAt,
  serverTimestampFromCalendarAndTime,
} from "./schedule-engine";

describe("schedule-engine", () => {
  it("computes reminder_at from scheduled start + delay", () => {
    const start = serverTimestampFromCalendarAndTime("2026-06-23", "00:15");
    const due = reminderAt(start, 60);
    expect(due.toISOString()).toBe("2026-06-23T03:15:00.000Z");
  });

  it("finds weekly slots in a window", () => {
    const windowStart = new Date("2026-06-23T00:00:00.000-02:00");
    const windowEnd = new Date("2026-06-27T23:59:59.000-02:00");
    const slots = computeWeeklyOccurrencesInWindow(
      [
        { dow: 2, timeSt: "00:45" },
        { dow: 5, timeSt: "00:15" },
      ],
      windowStart,
      windowEnd,
    );
    expect(slots.some((s) => s.occurrenceDate === "2026-06-23")).toBe(true);
    expect(slots.some((s) => s.occurrenceDate === "2026-06-26")).toBe(true);
  });

  it("computes interval-after-last occurrence", () => {
    const last = serverTimestampFromCalendarAndTime("2026-06-23", "00:15");
    const windowStart = new Date("2026-06-23T12:00:00.000-02:00");
    const windowEnd = new Date("2026-06-26T23:59:59.000-02:00");
    const next = computeNextIntervalOccurrence(
      last,
      2,
      "00:15",
      windowStart,
      windowEnd,
    );
    expect(next?.occurrenceDate).toBe("2026-06-25");
    expect(next?.scheduledStartAt.toISOString()).toBe(
      "2026-06-25T02:15:00.000Z",
    );
  });
});
