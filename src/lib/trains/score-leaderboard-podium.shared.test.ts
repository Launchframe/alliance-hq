import { describe, expect, it } from "vitest";

import {
  resolveScoreLeaderboardKind,
  SCORE_LEADERBOARD_LIST_MAX,
} from "@/lib/trains/score-leaderboard-podium.shared";

describe("resolveScoreLeaderboardKind", () => {
  it("returns tpif for both Price Is Freight boards", () => {
    expect(
      resolveScoreLeaderboardKind({
        rule: { kind: "price_is_freight", board: "weekday" },
      }),
    ).toBe("tpif");
    expect(
      resolveScoreLeaderboardKind({
        rule: { kind: "price_is_freight", board: "heavy_hitter" },
      }),
    ).toBe("tpif");
  });

  it("returns vs_push for a Top VS board", () => {
    expect(
      resolveScoreLeaderboardKind({ rule: { kind: "vs_top_n", topN: 10 } }),
    ).toBe("vs_push");
  });

  it("returns donations for the top-donor rule", () => {
    expect(
      resolveScoreLeaderboardKind({ rule: { kind: "donations_top" } }),
    ).toBe("donations");
  });

  it("returns null for pool rules and free choice", () => {
    expect(
      resolveScoreLeaderboardKind({
        rule: { kind: "rank_pool", pool: "r3", draw: "wheel" },
      }),
    ).toBeNull();
    expect(resolveScoreLeaderboardKind({ rule: null })).toBeNull();
  });

  it("inherits vs_push from the score reference day under lead time", () => {
    expect(
      resolveScoreLeaderboardKind({
        rule: null,
        trainDate: "2026-08-30",
        leadDays: 1,
        scoreDayRule: { kind: "vs_top_n", topN: 10 },
      }),
    ).toBe("vs_push");
  });

  it("keeps the train day's own board over the inherited one", () => {
    expect(
      resolveScoreLeaderboardKind({
        rule: { kind: "price_is_freight", board: "weekday" },
        trainDate: "2026-08-30",
        leadDays: 1,
        scoreDayRule: { kind: "vs_top_n", topN: 10 },
      }),
    ).toBe("tpif");
  });
});

describe("SCORE_LEADERBOARD_LIST_MAX", () => {
  it("lists through rank 10", () => {
    expect(SCORE_LEADERBOARD_LIST_MAX).toBe(10);
  });
});
