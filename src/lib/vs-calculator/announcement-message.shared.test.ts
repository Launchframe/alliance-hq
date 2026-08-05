import { describe, expect, it } from "vitest";

import { formatVsDailyAnnouncementMessage } from "@/lib/vs-calculator/announcement-message.shared";

describe("formatVsDailyAnnouncementMessage", () => {
  it("includes match day theme and save hints", () => {
    const message = formatVsDailyAnnouncementMessage({
      targetDate: "2024-01-08",
      radarSaveHint: "saveRadarForMonday",
      shinySaveHints: ["shinySpawnToday"],
      calculatorUrl: "https://example.com/tools/vs-calculator",
    });

    expect(message).toContain("VS Day 1");
    expect(message).toContain("Radar Training");
    expect(message).toContain("Save radar intel for Monday");
    expect(message).toContain("Shiny tasks spawn today");
    expect(message).toContain("https://example.com/tools/vs-calculator");
  });

  it("uses rest day header on Sunday target", () => {
    const message = formatVsDailyAnnouncementMessage({
      targetDate: "2024-01-07",
      radarSaveHint: null,
      shinySaveHints: [],
      calculatorUrl: "https://example.com/tools/vs-calculator",
    });

    expect(message).toContain("VS rest day");
  });

  it("shows reminder lines under a Reminders heading when there are no earn lines", () => {
    const message = formatVsDailyAnnouncementMessage({
      targetDate: "2024-01-07",
      radarSaveHint: null,
      shinySaveHints: [],
      reminderLines: ["Troops should be out gathering before Reset."],
      calculatorUrl: "https://example.com/tools/vs-calculator",
    });

    expect(message).toContain("Reminders");
    expect(message).toContain("Troops should be out gathering before Reset.");
    expect(message).not.toContain("Earn points");
  });

  it("prefers earn lines over reminder lines when both are provided", () => {
    const message = formatVsDailyAnnouncementMessage({
      targetDate: "2024-01-08",
      radarSaveHint: null,
      shinySaveHints: [],
      earnPointLines: ["Widget — 10 pts each"],
      reminderLines: ["Should not show"],
      calculatorUrl: "https://example.com/tools/vs-calculator",
    });

    expect(message).toContain("Earn points");
    expect(message).not.toContain("Reminders");
    expect(message).not.toContain("Should not show");
  });
});
