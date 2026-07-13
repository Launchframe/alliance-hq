import { describe, expect, it } from "vitest";

import { SERVER_TIME_IANA } from "@/lib/timezone/constants";
import {
  formatOptionsIncludeClockTime,
  formatTimeZoneLabel,
  getShortTimeZoneName,
  withTimeZoneLabel,
} from "@/lib/timezone/zone-label.shared";

describe("formatTimeZoneLabel", () => {
  it("uses ST for server mode", () => {
    expect(formatTimeZoneLabel("server")).toBe("ST");
  });

  it("uses ST when the IANA zone is game server time", () => {
    expect(formatTimeZoneLabel("local", new Date(), SERVER_TIME_IANA)).toBe(
      "ST",
    );
  });

  it("formats local labels with a short zone name", () => {
    const label = formatTimeZoneLabel(
      "local",
      "2026-07-11T22:00:00.000-04:00",
      "America/New_York",
    );
    expect(label).toMatch(/^Local \([A-Z]{2,5}\)$/);
    expect(label).not.toBe("ST");
  });
});

describe("withTimeZoneLabel", () => {
  it("appends the zone label once", () => {
    expect(withTimeZoneLabel("22:00", "server")).toBe("22:00 ST");
    expect(withTimeZoneLabel("22:00 ST", "server")).toBe("22:00 ST");
  });
});

describe("getShortTimeZoneName", () => {
  it("returns a short name for America/Los_Angeles in summer", () => {
    expect(
      getShortTimeZoneName("America/Los_Angeles", "2026-07-11T12:00:00.000Z"),
    ).toBe("PDT");
  });
});

describe("formatOptionsIncludeClockTime", () => {
  it("detects clock fields", () => {
    expect(formatOptionsIncludeClockTime({ timeStyle: "short" })).toBe(true);
    expect(formatOptionsIncludeClockTime({ hour: "numeric" })).toBe(true);
    expect(formatOptionsIncludeClockTime({ dateStyle: "short" })).toBe(false);
    expect(
      formatOptionsIncludeClockTime({ year: "numeric", month: "numeric" }),
    ).toBe(false);
  });
});
