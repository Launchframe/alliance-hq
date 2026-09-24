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
  formatBrowserLocalDateTime,
  formatRelativeAccountDateTime,
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
  it("displays UTC instants in Server Time with an ST label", () => {
    const formatted = formatAccountDateTime("2026-06-11T02:00:00.000Z", {
      locale: "en-US",
      timezoneId: DEFAULT_ACCOUNT_TIMEZONE_ID,
    });
    expect(formatted).toContain("6/11/2026");
    expect(formatted).toMatch(/12:00/);
    expect(formatted).toMatch(/\bST\b/);
  });

  it("displays UTC instants in a selected IANA zone with a Local label", () => {
    const formatted = formatAccountDateTime("2026-01-15T05:00:00.000Z", {
      locale: "en-US",
      timezoneId: "America/New_York",
    });
    expect(formatted).toContain("1/15/2026");
    expect(formatted).toMatch(/12:00/);
    expect(formatted).toMatch(/Local \(/);
  });

  it("allows dateStyle without mixing granular date/time fields", () => {
    expect(() =>
      formatAccountDateTime("2026-06-11T02:00:00.000Z", {
        locale: "en-US",
        timezoneId: DEFAULT_ACCOUNT_TIMEZONE_ID,
        dateStyle: "long",
      }),
    ).not.toThrow();
  });

  it("skips zone labels for date-only style", () => {
    const formatted = formatAccountDateTime("2026-06-11T02:00:00.000Z", {
      locale: "en-US",
      timezoneId: DEFAULT_ACCOUNT_TIMEZONE_ID,
      dateStyle: "short",
    });
    expect(formatted).not.toMatch(/\bST\b/);
    expect(formatted).not.toMatch(/Local \(/);
  });
});

describe("formatBrowserLocalDateTime", () => {
  it("respects an explicit locale for date formatting", () => {
    const formatted = formatBrowserLocalDateTime(
      "2026-06-11T18:30:00.000Z",
      { dateStyle: "short", timeStyle: "short" },
      "pt-BR",
    );
    expect(formatted).toMatch(/11\/06\/2026/);
    expect(formatted).toMatch(/Local \(/);
  });
});

describe("formatRelativeAccountDateTime", () => {
  const labels = {
    todayAt: (time: string) => `Today at ${time}`,
    yesterdayAt: (time: string) => `Yesterday at ${time}`,
    weekdayAt: (weekday: string, time: string) => `${weekday} at ${time}`,
    lastWeekday: (weekday: string) => `Last ${weekday}`,
  };
  const timezoneId = "America/Los_Angeles";
  const now = new Date("2026-09-23T20:00:00.000Z"); // Wednesday afternoon PDT

  it("uses today / yesterday / weekday / last-week buckets without a zone suffix", () => {
    const today = formatRelativeAccountDateTime("2026-09-24T03:01:00.000Z", {
      locale: "en-US",
      timezoneId,
      now,
      labels,
    });
    expect(today).toMatch(/^Today at /);
    expect(today).not.toMatch(/PDT|Local|ST/);

    const yesterday = formatRelativeAccountDateTime(
      "2026-09-23T03:01:00.000Z",
      { locale: "en-US", timezoneId, now, labels },
    );
    expect(yesterday).toMatch(/^Yesterday at /);

    const earlierThisWeek = formatRelativeAccountDateTime(
      "2026-09-21T03:01:00.000Z",
      { locale: "en-US", timezoneId, now, labels },
    );
    expect(earlierThisWeek).toMatch(/^Sunday at /);

    const lastWeek = formatRelativeAccountDateTime("2026-09-16T19:00:00.000Z", {
      locale: "en-US",
      timezoneId,
      now,
      labels,
    });
    expect(lastWeek).toBe("Last Wednesday");
  });

  it("falls back to a short date for older timestamps", () => {
    expect(
      formatRelativeAccountDateTime("2026-07-31T03:33:49.000Z", {
        locale: "en-US",
        timezoneId,
        now,
        labels,
      }),
    ).toMatch(/7\/3[01]\/26/);
  });

  it("uses server-time calendar days without a zone suffix", () => {
    const serverNow = new Date("2026-09-23T20:00:00.000Z");
    const today = formatRelativeAccountDateTime("2026-09-23T21:00:00.000Z", {
      locale: "en-US",
      timezoneId: DEFAULT_ACCOUNT_TIMEZONE_ID,
      now: serverNow,
      labels,
    });
    expect(today).toMatch(/^Today at /);
    expect(today).not.toMatch(/\bST\b|Local/);
  });

  it("treats dayDiff 6 as weekday-at and 7 as last weekday", () => {
    expect(
      formatRelativeAccountDateTime("2026-09-17T20:00:00.000Z", {
        locale: "en-US",
        timezoneId,
        now,
        labels,
      }),
    ).toMatch(/^Thursday at /);
    expect(
      formatRelativeAccountDateTime("2026-09-16T20:00:00.000Z", {
        locale: "en-US",
        timezoneId,
        now,
        labels,
      }),
    ).toBe("Last Wednesday");
  });

  it("falls back to a short date for future timestamps", () => {
    expect(
      formatRelativeAccountDateTime("2026-09-25T20:00:00.000Z", {
        locale: "en-US",
        timezoneId,
        now,
        labels,
      }),
    ).toMatch(/9\/25\/26/);
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
