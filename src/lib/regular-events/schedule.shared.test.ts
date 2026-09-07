import { describe, expect, it } from "vitest";

import {
  announceAtFromStart,
  defaultRulesForAlliance,
  parseWeeklySlots,
  zombieSiegeTimeSt,
  zombieSiegeWeeklySlots,
} from "./schedule.shared";
import {
  computeNextIntervalOccurrence,
  computeWeeklyOccurrencesInWindow,
  serverTimestampFromCalendarAndTime,
} from "@/lib/eur/schedule-engine";
import { MARSHAL_GUARD_DEFAULT_INTERVAL_DAYS } from "./catalog.shared";

describe("regular-events schedule", () => {
  it("uses 23:00 for Zombie Siege when Canyon Storm is off", () => {
    expect(zombieSiegeTimeSt(false)).toBe("23:00");
    expect(zombieSiegeWeeklySlots(false)).toEqual([
      { dow: 1, timeSt: "23:00" },
      { dow: 4, timeSt: "23:00" },
    ]);
  });

  it("uses 23:30 for Zombie Siege when Canyon Storm is active", () => {
    expect(zombieSiegeTimeSt(true)).toBe("23:30");
    const slots = zombieSiegeWeeklySlots(true);
    expect(slots.every((s) => s.timeSt === "23:30")).toBe(true);

    const windowStart = new Date("2026-06-22T00:00:00.000-02:00"); // Mon
    const windowEnd = new Date("2026-06-26T23:59:59.000-02:00");
    const occ = computeWeeklyOccurrencesInWindow(slots, windowStart, windowEnd);
    const mon = occ.find((o) => o.occurrenceDate === "2026-06-22");
    expect(mon?.scheduledStartAt.toISOString()).toBe(
      serverTimestampFromCalendarAndTime("2026-06-22", "23:30").toISOString(),
    );
  });

  it("defaults Marshal Guard to interval_after_last every 2 days at 23:00", () => {
    const defaults = defaultRulesForAlliance(false);
    const marshal = defaults.find((r) => r.eventKey === "marshal_guard");
    expect(marshal?.scheduleKind).toBe("interval_after_last");
    expect(marshal?.intervalDays).toBe(MARSHAL_GUARD_DEFAULT_INTERVAL_DAYS);
    expect(marshal?.anchorTimeSt).toBe("23:00");

    const last = serverTimestampFromCalendarAndTime("2026-06-23", "23:00");
    const windowStart = new Date("2026-06-24T00:00:00.000-02:00");
    const windowEnd = new Date("2026-06-27T23:59:59.000-02:00");
    const next = computeNextIntervalOccurrence(
      last,
      MARSHAL_GUARD_DEFAULT_INTERVAL_DAYS,
      "23:00",
      windowStart,
      windowEnd,
    );
    expect(next?.occurrenceDate).toBe("2026-06-25");
    expect(next?.scheduledStartAt.toISOString()).toBe(
      serverTimestampFromCalendarAndTime("2026-06-25", "23:00").toISOString(),
    );
  });

  it("computes announce_at 60 minutes before start", () => {
    const start = serverTimestampFromCalendarAndTime("2026-06-23", "23:00");
    const announce = announceAtFromStart(start, 60);
    expect(announce.toISOString()).toBe(
      new Date(start.getTime() - 60 * 60 * 1000).toISOString(),
    );
  });

  it("parses weekly slots and rejects invalid time", () => {
    expect(
      parseWeeklySlots([
        { dow: 1, timeSt: "23:00" },
        { dow: 4, timeSt: "23:30" },
      ]),
    ).toHaveLength(2);
    expect(parseWeeklySlots([{ dow: 1, timeSt: "25:00" }])).toBeNull();
    expect(parseWeeklySlots([{ dow: 8, timeSt: "23:00" }])).toBeNull();
  });
});
