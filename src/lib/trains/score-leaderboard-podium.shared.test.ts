import { describe, expect, it } from "vitest";

import {
  resolveScoreLeaderboardKind,
  SCORE_LEADERBOARD_LIST_MAX,
} from "@/lib/trains/score-leaderboard-podium.shared";

describe("resolveScoreLeaderboardKind", () => {
  it("returns tpif for Price Is Freight paint", () => {
    expect(
      resolveScoreLeaderboardKind({
        paintTemplate: "price_is_right_weekdays",
        conductorMechanism: "r3_lottery",
      }),
    ).toBe("tpif");
  });

  it("returns vs_push for Top VS mechanism", () => {
    expect(
      resolveScoreLeaderboardKind({
        paintTemplate: "top_vs",
        conductorMechanism: "vs_top_n",
      }),
    ).toBe("vs_push");
  });

  it("returns vs_push for VS push week paint", () => {
    expect(
      resolveScoreLeaderboardKind({
        paintTemplate: "vs_push_weekdays",
        conductorMechanism: "r3_lottery",
      }),
    ).toBe("vs_push");
  });

  it("returns donations for donations week", () => {
    expect(
      resolveScoreLeaderboardKind({
        paintTemplate: "donations_week",
        conductorMechanism: "donations_top",
      }),
    ).toBe("donations");
  });

  it("returns null when no score leaderboard applies", () => {
    expect(
      resolveScoreLeaderboardKind({
        paintTemplate: "economy_week",
        conductorMechanism: "r3_lottery",
      }),
    ).toBeNull();
  });
});

describe("SCORE_LEADERBOARD_LIST_MAX", () => {
  it("lists through rank 10", () => {
    expect(SCORE_LEADERBOARD_LIST_MAX).toBe(10);
  });
});
