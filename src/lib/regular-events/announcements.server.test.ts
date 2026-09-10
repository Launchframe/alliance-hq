import { describe, expect, it } from "vitest";

import { formatRegularEventAnnouncementMessage } from "./announcements.server";
import { serverTimestampFromCalendarAndTime } from "@/lib/eur/schedule-engine";

describe("formatRegularEventAnnouncementMessage", () => {
  it("formats en-US one-hour reminder with server time label", () => {
    const scheduledStartAt = serverTimestampFromCalendarAndTime(
      "2026-06-23",
      "23:30",
    );
    const message = formatRegularEventAnnouncementMessage({
      eventKey: "zombie_siege",
      scheduledStartAt,
      locale: "en-US",
    });
    expect(message).toBe(
      "Zombie Siege starts in 1 hour (23:30 server time).",
    );
  });

  it("formats pt-BR one-hour reminder", () => {
    const scheduledStartAt = serverTimestampFromCalendarAndTime(
      "2026-06-23",
      "23:00",
    );
    const message = formatRegularEventAnnouncementMessage({
      eventKey: "marshal_guard",
      scheduledStartAt,
      locale: "pt-BR",
    });
    expect(message).toBe(
      "Alliance Exercise começa em 1 hora (23:00 horário do servidor).",
    );
  });
});

describe("formatRegularEventUploadReminderTitle", () => {
  it("uses Alliance Exercise label", async () => {
    const { formatRegularEventUploadReminderTitle } = await import(
      "./announcements.server"
    );
    expect(
      formatRegularEventUploadReminderTitle({ eventKey: "marshal_guard" }),
    ).toBe("Upload scores for today's Alliance Exercise");
  });
});

describe("formatRegularEventScheduleInGameReminder", () => {
  it("uses approved TODO copy", async () => {
    const { formatRegularEventScheduleInGameReminder } = await import(
      "./announcements.server"
    );
    const scheduledStartAt = serverTimestampFromCalendarAndTime(
      "2026-09-09",
      "23:00",
    );
    expect(
      formatRegularEventScheduleInGameReminder({
        eventKey: "glacierdon",
        scheduledStartAt,
        locale: "en-US",
      }),
    ).toBe("TODO: schedule Glacierdon for 23:00 Server Time.");
  });
});
