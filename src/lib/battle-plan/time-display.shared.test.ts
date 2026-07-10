import { describe, expect, it } from "vitest";

import {
  buildDefaultCaptureDateTime,
  getZonedDateTimeParts,
  isBattlePlanTimeDisplay,
  zonedDateTimeToIso,
} from "@/lib/battle-plan/time-display.shared";
import { SERVER_TIME_IANA } from "@/lib/timezone/constants";

describe("battle plan time display", () => {
  it("validates stored display modes", () => {
    expect(isBattlePlanTimeDisplay("local")).toBe(true);
    expect(isBattlePlanTimeDisplay("server")).toBe(true);
    expect(isBattlePlanTimeDisplay("utc")).toBe(false);
  });

  it("round-trips server-zoned date and time to ISO", () => {
    const iso = zonedDateTimeToIso("2026-07-10", "14:30", SERVER_TIME_IANA);
    expect(getZonedDateTimeParts(iso, SERVER_TIME_IANA)).toEqual({
      date: "2026-07-10",
      time: "14:30",
    });
  });

  it("defaults to the current instant when no calendar day is selected", () => {
    const now = new Date("2026-07-10T18:45:00.000Z");
    expect(buildDefaultCaptureDateTime("server", null, now)).toEqual(
      getZonedDateTimeParts(now, SERVER_TIME_IANA),
    );
  });

  it("keeps a selected server calendar day in server display mode", () => {
    const now = new Date("2026-07-10T18:45:00.000Z");
    const parts = buildDefaultCaptureDateTime("server", "2026-07-12", now);
    expect(parts.date).toBe("2026-07-12");
    expect(parts.time).toBe(
      getZonedDateTimeParts(now, SERVER_TIME_IANA).time,
    );
  });
});
