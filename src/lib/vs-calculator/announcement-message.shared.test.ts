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
});
