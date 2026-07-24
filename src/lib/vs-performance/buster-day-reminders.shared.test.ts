import { describe, expect, it } from "vitest";

import { SERVER_TIME_UTC_OFFSET } from "@/lib/timezone/constants";
import {
  BUSTER_DAY_POST_REMINDER_HOUR_ST,
  BUSTER_DAY_PRE_REMINDER_HOUR_ST,
  buildBusterDayReminderDiscordMessage,
  buildBusterDayReminderEmail,
  getServerHourOfDay,
  resolveBusterDayReminderKind,
} from "./buster-day-reminders.shared";

/** Build an instant that is `hour:minute` on `date` in Server Time (UTC−2). */
function atServerTime(date: string, hour: number, minute = 0): Date {
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return new Date(`${date}T${hh}:${mm}:00.000${SERVER_TIME_UTC_OFFSET}`);
}

describe("resolveBusterDayReminderKind", () => {
  it("fires pre on Friday at 20:00 ST", () => {
    // 2026-07-17 is a Friday
    expect(resolveBusterDayReminderKind(atServerTime("2026-07-17", 20, 0))).toBe(
      "pre",
    );
    expect(
      resolveBusterDayReminderKind(atServerTime("2026-07-17", 20, 45)),
    ).toBe("pre");
  });

  it("does not fire pre outside Friday 20:xx ST", () => {
    expect(resolveBusterDayReminderKind(atServerTime("2026-07-17", 19, 59))).toBe(
      null,
    );
    expect(resolveBusterDayReminderKind(atServerTime("2026-07-17", 21, 0))).toBe(
      null,
    );
    // Saturday
    expect(resolveBusterDayReminderKind(atServerTime("2026-07-18", 20, 0))).toBe(
      null,
    );
  });

  it("fires post on Sunday at 00:xx ST", () => {
    // 2026-07-19 is a Sunday
    expect(resolveBusterDayReminderKind(atServerTime("2026-07-19", 0, 0))).toBe(
      "post",
    );
    expect(resolveBusterDayReminderKind(atServerTime("2026-07-19", 0, 30))).toBe(
      "post",
    );
  });

  it("does not fire post outside Sunday 00:xx ST", () => {
    expect(resolveBusterDayReminderKind(atServerTime("2026-07-19", 1, 0))).toBe(
      null,
    );
    // Monday midnight
    expect(resolveBusterDayReminderKind(atServerTime("2026-07-20", 0, 0))).toBe(
      null,
    );
  });

  it("exports expected trigger hours", () => {
    expect(BUSTER_DAY_PRE_REMINDER_HOUR_ST).toBe(20);
    expect(BUSTER_DAY_POST_REMINDER_HOUR_ST).toBe(0);
  });
});

describe("getServerHourOfDay", () => {
  it("reads hour in Server Time", () => {
    expect(getServerHourOfDay(atServerTime("2026-07-17", 20, 15))).toBe(20);
    expect(getServerHourOfDay(atServerTime("2026-07-19", 0, 5))).toBe(0);
  });
});

describe("reminder copy builders", () => {
  it("includes wizard URL in Discord and email", () => {
    const url = "https://frontline.gay/vs-performance/buster-day";
    const discord = buildBusterDayReminderDiscordMessage({
      kind: "pre",
      allianceTag: "ABC",
      wizardUrl: url,
    });
    expect(discord).toContain(url);
    expect(discord).toContain("ABC");

    const email = buildBusterDayReminderEmail({
      kind: "post",
      allianceTag: "ABC",
      wizardUrl: url,
    });
    expect(email.subject).toContain("ABC");
    expect(email.text).toContain(url);
    expect(email.html).toContain(url);
  });
});
