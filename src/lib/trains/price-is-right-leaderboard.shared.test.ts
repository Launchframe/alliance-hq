import { describe, expect, it } from "vitest";

import {
  buildPriceIsRightVsLeaderboard,
  formatPriceIsRightLeaderboardDiscordMessage,
  formatPriceIsRightLeaderboardEntryLine,
} from "@/lib/trains/price-is-right-leaderboard.shared";

describe("buildPriceIsRightVsLeaderboard", () => {
  it("ranks by closest prior-day VS to 7.2M from above", () => {
    const scores = new Map([
      ["a", 7_500_000],
      ["b", 7_200_000],
      ["c", 7_100_000],
      ["d", 8_000_000],
    ]);
    const entries = buildPriceIsRightVsLeaderboard(
      [
        { memberId: "a", memberName: "Alpha" },
        { memberId: "b", memberName: "Beta" },
        { memberId: "c", memberName: "Charlie" },
        { memberId: "d", memberName: "Delta" },
      ],
      scores,
    );
    expect(entries.map((e) => e.memberName)).toEqual([
      "Beta",
      "Alpha",
      "Delta",
    ]);
    expect(entries.map((e) => e.rank)).toEqual([1, 2, 3]);
  });

  it("omits members below 7.2M or with no score", () => {
    const entries = buildPriceIsRightVsLeaderboard(
      [
        { memberId: "a", memberName: "Alpha" },
        { memberId: "b", memberName: "Beta" },
      ],
      new Map([["b", 7_199_999]]),
    );
    expect(entries).toEqual([]);
  });
});

describe("formatPriceIsRightLeaderboardEntryLine", () => {
  it("includes rank and formatted score", () => {
    expect(
      formatPriceIsRightLeaderboardEntryLine({
        rank: 2,
        memberName: "Gaby",
        priorDayVsScore: 7_250_000,
      }),
    ).toBe("#2 Gaby — 7.3M");
  });
});

describe("formatPriceIsRightLeaderboardDiscordMessage", () => {
  it("formats podium lines with medals, rank, and score", () => {
    const message = formatPriceIsRightLeaderboardDiscordMessage({
      trainDate: "2026-07-09",
      scoreDate: "2026-07-08",
      entries: [
        {
          rank: 1,
          memberId: "a",
          memberName: "Redd",
          priorDayVsScore: 7_200_000,
        },
        {
          rank: 2,
          memberId: "b",
          memberName: "Gaby",
          priorDayVsScore: 7_250_000,
        },
      ],
      trainsUrl: "https://hq.example/trains",
    });
    expect(message).toContain("**#1 Redd — 7.2M**");
    expect(message).toContain("**#2 Gaby — 7.3M**");
    expect(message).toContain("closest to 7.2M");
    expect(message).toContain("https://hq.example/trains");
  });
});
