import { describe, expect, it } from "vitest";

import {
  latestLockedDateInWeek,
  weekHasPersistedSchedule,
} from "@/lib/trains/week-template-change.shared";

describe("weekHasPersistedSchedule", () => {
  const weekStart = "2026-06-08";

  it("is false when there is no schedule row and only preview configs", () => {
    expect(
      weekHasPersistedSchedule(null, weekStart, [
        { id: "preview-2026-06-08" },
      ]),
    ).toBe(false);
  });

  it("is true when the current week has a schedule row", () => {
    expect(
      weekHasPersistedSchedule(
        { weekStart },
        weekStart,
        [{ id: "preview-2026-06-08" }],
      ),
    ).toBe(true);
  });

  it("is true when day configs are persisted", () => {
    expect(
      weekHasPersistedSchedule(null, weekStart, [
        { id: "day-config-abc" },
      ]),
    ).toBe(true);
  });
});

describe("latestLockedDateInWeek", () => {
  const weekStart = "2026-06-08";
  const weekEnd = "2026-06-14";

  it("returns null when nothing is locked", () => {
    expect(
      latestLockedDateInWeek(
        [{ date: "2026-06-09", lockedAt: null }],
        weekStart,
        weekEnd,
      ),
    ).toBeNull();
  });

  it("returns the latest locked calendar day in the week", () => {
    expect(
      latestLockedDateInWeek(
        [
          { date: "2026-06-09", lockedAt: "2026-06-09T12:00:00.000Z" },
          { date: "2026-06-11", lockedAt: "2026-06-11T12:00:00.000Z" },
        ],
        weekStart,
        weekEnd,
      ),
    ).toBe("2026-06-11");
  });

  it("ignores locks outside the week", () => {
    expect(
      latestLockedDateInWeek(
        [{ date: "2026-06-15", lockedAt: "2026-06-15T12:00:00.000Z" }],
        weekStart,
        weekEnd,
      ),
    ).toBeNull();
  });
});
