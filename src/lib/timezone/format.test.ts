import { describe, expect, it } from "vitest";

import {
  normalizeAccountTimezoneId,
  resolveAccountTimeZoneIana,
} from "@/lib/timezone/account";
import {
  accountCalendarDateToUtcEnd,
  accountCalendarDateToUtcStart,
  formatAccountDate,
  formatAccountDateTime,
} from "@/lib/timezone/format";
import { DEFAULT_ACCOUNT_TIMEZONE_ID } from "@/lib/timezone/constants";

describe("normalizeAccountTimezoneId", () => {
  it("defaults null to server", () => {
    expect(normalizeAccountTimezoneId(null)).toBe(DEFAULT_ACCOUNT_TIMEZONE_ID);
  });
});

describe("accountCalendarDateToUtcStart", () => {
  it("maps Server Time midnight to UTC+2h", () => {
    expect(
      accountCalendarDateToUtcStart("2026-06-11", DEFAULT_ACCOUNT_TIMEZONE_ID)
        ?.toISOString(),
    ).toBe("2026-06-11T02:00:00.000Z");
  });

  it("maps Eastern calendar days using the zone offset", () => {
    expect(
      accountCalendarDateToUtcStart("2026-01-15", "America/New_York")
        ?.toISOString(),
    ).toBe("2026-01-15T05:00:00.000Z");
  });
});

describe("accountCalendarDateToUtcEnd", () => {
  it("maps Server Time end-of-day to UTC", () => {
    expect(
      accountCalendarDateToUtcEnd("2026-06-11", DEFAULT_ACCOUNT_TIMEZONE_ID)
        ?.toISOString(),
    ).toBe("2026-06-12T01:59:59.999Z");
  });
});

describe("formatAccountDateTime", () => {
  it("displays UTC instants in Server Time", () => {
    const formatted = formatAccountDateTime("2026-06-11T02:00:00.000Z", {
      locale: "en-US",
      timezoneId: DEFAULT_ACCOUNT_TIMEZONE_ID,
    });
    expect(formatted).toContain("6/11/2026");
    expect(formatted).toMatch(/12:00/);
  });

  it("displays UTC instants in a selected IANA zone", () => {
    const formatted = formatAccountDateTime("2026-01-15T05:00:00.000Z", {
      locale: "en-US",
      timezoneId: "America/New_York",
    });
    expect(formatted).toContain("1/15/2026");
    expect(formatted).toMatch(/12:00/);
  });
});

describe("formatAccountDate", () => {
  it("formats pt-BR dates in Server Time", () => {
    expect(
      formatAccountDate("2026-06-11T02:00:00.000Z", {
        locale: "pt-BR",
        timezoneId: DEFAULT_ACCOUNT_TIMEZONE_ID,
      }),
    ).toBe("11/06/26");
  });
});

describe("resolveAccountTimeZoneIana", () => {
  it("maps server to fixed IANA zone", () => {
    expect(resolveAccountTimeZoneIana(DEFAULT_ACCOUNT_TIMEZONE_ID)).toBe(
      "Etc/GMT+2",
    );
  });
});
