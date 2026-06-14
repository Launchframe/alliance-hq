import { describe, expect, it } from "vitest";

import {
  formatServerDateTime,
  serverCalendarDateToUtcEnd,
  serverCalendarDateToUtcStart,
} from "@/lib/server-time";

describe("serverCalendarDateToUtcStart", () => {
  it("maps Server Time midnight to UTC+2h", () => {
    expect(serverCalendarDateToUtcStart("2026-06-11")?.toISOString()).toBe(
      "2026-06-11T02:00:00.000Z",
    );
  });
});

describe("serverCalendarDateToUtcEnd", () => {
  it("maps Server Time end-of-day to UTC next hour", () => {
    expect(serverCalendarDateToUtcEnd("2026-06-11")?.toISOString()).toBe(
      "2026-06-12T01:59:59.999Z",
    );
  });
});

describe("formatServerDateTime", () => {
  it("displays UTC instants in Server Time", () => {
    const formatted = formatServerDateTime("2026-06-11T02:00:00.000Z", {
      locale: "en-US",
    });
    expect(formatted).toContain("6/11/2026");
    expect(formatted).toMatch(/12:00/);
  });
});
