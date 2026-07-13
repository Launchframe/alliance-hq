import { describe, expect, it } from "vitest";

import {
  buildDefaultCaptureDateTime,
  formatCaptureDateTime,
  formatCaptureTime,
  getZonedDateTimeParts,
  isBattlePlanTimeDisplay,
  resolveBattlePlanIana,
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

  it("formats server times in 24-hour clock with an ST label", () => {
    const iso = zonedDateTimeToIso("2026-07-10", "14:30", SERVER_TIME_IANA);
    expect(formatCaptureTime(iso, "server")).toMatch(/14:30/);
    expect(formatCaptureTime(iso, "server")).toMatch(/\bST\b/);
    expect(formatCaptureTime(iso, "server")).not.toMatch(/AM|PM/i);
    expect(formatCaptureDateTime(iso, "server")).toMatch(/14:30/);
    expect(formatCaptureDateTime(iso, "server")).toMatch(/\bST\b/);
    expect(formatCaptureDateTime(iso, "server")).not.toMatch(/AM|PM/i);
  });

  it("keeps a selected calendar day in local display mode", () => {
    const now = new Date("2026-07-10T18:45:00.000Z");
    const localTz = resolveBattlePlanIana("local");
    const parts = buildDefaultCaptureDateTime("local", "2026-07-12", now);
    expect(parts.date).toBe("2026-07-12");
    expect(parts.time).toBe(getZonedDateTimeParts(now, localTz).time);
  });

  it("formats calendar times in 24-hour clock with a Local label", () => {
    const iso = zonedDateTimeToIso("2026-07-10", "22:00", SERVER_TIME_IANA);
    const formatted = formatCaptureTime(iso, "local", { hour12: false });
    expect(formatted).toMatch(/\d{1,2}:\d{2}/);
    expect(formatted).toMatch(/Local \(/);
    expect(formatted).not.toMatch(/AM|PM/i);
  });
});
