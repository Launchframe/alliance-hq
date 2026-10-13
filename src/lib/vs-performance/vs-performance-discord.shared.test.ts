import { describe, expect, it } from "vitest";

import {
  buildVsPerformanceDiscordTopEntries,
  formatVsPerformanceDayHeading,
  formatVsPerformanceFinalizedDiscordMessage,
  formatVsPerformanceParsedDiscordMessage,
} from "@/lib/vs-performance/vs-performance-discord.shared";

describe("vs-performance Discord messages", () => {
  it("builds top entries by in-game rank", () => {
    const entries = buildVsPerformanceDiscordTopEntries([
      { rank: 3, memberName: "Third", score: "10M", deleted: 0 },
      { rank: 1, memberName: "First", score: "15M", deleted: 0 },
      { rank: 2, ocrName: "Second", score: "12M", deleted: 0 },
      { rank: 4, memberName: "Skipped", score: "8M", deleted: 0 },
      { rank: 5, memberName: "Also skipped", score: "7M", deleted: 0 },
      { rank: 6, memberName: "Way back", score: "1M", deleted: 0 },
    ]);

    expect(entries.map((entry) => entry.memberName)).toEqual([
      "First",
      "Second",
      "Third",
      "Skipped",
      "Also skipped",
    ]);
  });

  it("ignores deleted rows and sanitizes @ in names", () => {
    const entries = buildVsPerformanceDiscordTopEntries([
      { rank: 1, memberName: "@[TAG] Player", score: "9M", deleted: 0 },
      { rank: 2, memberName: "Removed", score: "8M", deleted: 1 },
    ]);

    expect(entries).toEqual([
      { rank: 1, memberName: "@\u200b[TAG] Player", score: "9M" },
    ]);
  });

  it("formats parsed and finalized messages", () => {
    const parsed = formatVsPerformanceParsedDiscordMessage({
      memberCount: 42,
      entries: [
        { rank: 1, memberName: "Alpha", score: "15M" },
        { rank: 2, memberName: "Beta", score: "12M" },
      ],
      reviewUrl: "https://hq.example.com/tools/video-upload/job-1/review",
    });

    expect(parsed).toContain("parsed, ready for review");
    expect(parsed).toContain("42 members recognized");
    expect(parsed).toContain("🥇 **#1 Alpha — 15M**");
    expect(parsed).toContain("job-1/review");

    const dayHeading = formatVsPerformanceDayHeading({
      recordedDate: "2026-07-09",
      vsPeriod: "daily",
    });
    expect(dayHeading).toBe("Day 4 · Train Heroes (2026-07-09)");

    const finalized = formatVsPerformanceFinalizedDiscordMessage({
      dayHeading: dayHeading!,
      submittedCount: 42,
      entries: [{ rank: 1, memberName: "Alpha", score: "15M" }],
      vsPerformanceUrl: "https://hq.example.com/vs-performance",
    });

    expect(finalized).toContain("VS Performance — Day 4 · Train Heroes (2026-07-09)");
    expect(finalized).toContain("Submitted 42 scores");
    expect(finalized).toContain("/vs-performance");
  });

  it("formats weekly day headings", () => {
    expect(
      formatVsPerformanceDayHeading({
        recordedDate: "2026-07-12",
        vsPeriod: "weekly",
      }),
    ).toBe("Week ending Sunday (2026-07-12)");
  });
});
