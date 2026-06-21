import { describe, expect, it } from "vitest";

import { resolveTrainNextDeparture } from "@/lib/trains/trains-server-time.shared";

describe("resolveTrainNextDeparture", () => {
  it("returns awaiting when not locked", () => {
    expect(
      resolveTrainNextDeparture({
        selectedDate: "2026-06-21",
        today: "2026-06-21",
        lockedAtIso: null,
      }),
    ).toEqual({ state: "awaiting_selection" });
  });

  it("returns on_platform within four hours of lock", () => {
    const lockedAt = new Date("2026-06-21T10:00:00.000Z");
    const now = new Date("2026-06-21T12:00:00.000Z");
    expect(
      resolveTrainNextDeparture({
        selectedDate: "2026-06-21",
        today: "2026-06-21",
        lockedAtIso: lockedAt.toISOString(),
        now,
      }),
    ).toEqual({ state: "on_platform" });
  });

  it("returns reset after four hours with next calendar day", () => {
    const lockedAt = new Date("2026-06-21T04:00:00.000Z");
    const now = new Date("2026-06-21T10:00:00.000Z");
    expect(
      resolveTrainNextDeparture({
        selectedDate: "2026-06-21",
        today: "2026-06-21",
        lockedAtIso: lockedAt.toISOString(),
        now,
      }),
    ).toEqual({ state: "reset", resetDate: "2026-06-22" });
  });
});
