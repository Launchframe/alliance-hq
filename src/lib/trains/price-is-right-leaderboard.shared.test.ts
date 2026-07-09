import { describe, expect, it } from "vitest";

import {
  buildPriceIsRightVsLeaderboard,
  formatPriceIsRightLeaderboardDiscordMessage,
} from "@/lib/trains/price-is-right-leaderboard.shared";

describe("buildPriceIsRightVsLeaderboard", () => {
  it("ranks by prior-day VS descending", () => {
    const scores = new Map([
      ["a", 5_600_000],
      ["b", 5_100_000],
      ["c", 4_000_000],
    ]);
    const entries = buildPriceIsRightVsLeaderboard(
      [
        { memberId: "b", memberName: "Beta" },
        { memberId: "a", memberName: "Alpha" },
        { memberId: "c", memberName: "Charlie" },
      ],
      scores,
    );
    expect(entries.map((e) => e.memberName)).toEqual([
      "Alpha",
      "Beta",
      "Charlie",
    ]);
    expect(entries.map((e) => e.rank)).toEqual([1, 2, 3]);
  });

  it("omits members with zero score", () => {
    const entries = buildPriceIsRightVsLeaderboard(
      [{ memberId: "a", memberName: "Alpha" }],
      new Map(),
    );
    expect(entries).toEqual([]);
  });
});

describe("formatPriceIsRightLeaderboardDiscordMessage", () => {
  it("formats podium lines with medals", () => {
    const message = formatPriceIsRightLeaderboardDiscordMessage({
      trainDate: "2026-07-09",
      scoreDate: "2026-07-08",
      entries: [
        {
          rank: 1,
          memberId: "a",
          memberName: "Redd",
          priorDayVsScore: 5_600_000,
        },
        {
          rank: 2,
          memberId: "b",
          memberName: "Gaby",
          priorDayVsScore: 5_100_000,
        },
      ],
      trainsUrl: "https://hq.example/trains",
    });
    expect(message).toContain("Redd");
    expect(message).toContain("5.6M");
    expect(message).toContain("https://hq.example/trains");
  });
});
