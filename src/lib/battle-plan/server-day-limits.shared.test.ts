import { describe, expect, it } from "vitest";

import {
  countScheduledCapturesForDay,
  validateServerDayCaptureLimit,
} from "@/lib/battle-plan/server-day-limits.shared";

const events = [
  {
    id: "a",
    serverCalendarDate: "2026-07-09",
    territoryType: "stronghold" as const,
    status: "scheduled",
  },
  {
    id: "b",
    serverCalendarDate: "2026-07-09",
    territoryType: "stronghold" as const,
    status: "scheduled",
  },
  {
    id: "c",
    serverCalendarDate: "2026-07-09",
    territoryType: "city" as const,
    status: "scheduled",
  },
  {
    id: "d",
    serverCalendarDate: "2026-07-10",
    territoryType: "city" as const,
    status: "scheduled",
  },
];

describe("server-day capture limits", () => {
  it("counts scheduled events per type per server day", () => {
    expect(
      countScheduledCapturesForDay(events, "2026-07-09", "stronghold"),
    ).toBe(2);
    expect(countScheduledCapturesForDay(events, "2026-07-09", "city")).toBe(1);
  });

  it("excludes cancelled events and the event being edited", () => {
    const withCancelled = [
      ...events,
      {
        id: "e",
        serverCalendarDate: "2026-07-09",
        territoryType: "city" as const,
        status: "cancelled",
      },
    ];
    expect(
      countScheduledCapturesForDay(
        withCancelled,
        "2026-07-09",
        "city",
        "c",
      ),
    ).toBe(0);
  });

  it("blocks a third capture of the same type on one server day", () => {
    expect(
      validateServerDayCaptureLimit({
        events,
        serverCalendarDate: "2026-07-09",
        territoryType: "stronghold",
      }),
    ).toMatch(/already has 2 scheduled stronghold captures/);
    expect(
      validateServerDayCaptureLimit({
        events,
        serverCalendarDate: "2026-07-09",
        territoryType: "city",
      }),
    ).toBeNull();
  });
});
