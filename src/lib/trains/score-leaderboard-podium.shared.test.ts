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

  it("inherits vs_push from score reference day under lead time", () => {
    expect(
      resolveScoreLeaderboardKind({
        paintTemplate: "vs_push_week_lead_time",
        conductorMechanism: "custom",
        trainDate: "2026-08-30",
        leadDays: 1,
        scoreDateDay: {
          conductorMechanism: "vs_top_10",
          paintTemplate: "vs_push_weekdays",
        },
      }),
    ).toBe("vs_push");
  });

  it("inherits tpif when train day is painted eligible VS", () => {
    expect(
      resolveScoreLeaderboardKind({
        paintTemplate: "price_is_right_weekdays",
        conductorMechanism: "r3_lottery",
        trainDate: "2026-08-30",
        leadDays: 1,
        scoreDateDay: {
          conductorMechanism: "vs_top_10",
          paintTemplate: "vs_push_weekdays",
        },
      }),
    ).toBe("tpif");
  });

  it("prefers tpif from week template when day paint is still VS push", () => {
    expect(
      resolveScoreLeaderboardKind({
        paintTemplate: "vs_push_weekdays",
        conductorMechanism: "vs_top_10",
        trainDate: "2026-08-26",
        weekTemplateType: "price_is_right",
        weekStart: "2026-08-25",
      }),
    ).toBe("tpif");
  });
});

describe("SCORE_LEADERBOARD_LIST_MAX", () => {
  it("lists through rank 10", () => {
    expect(SCORE_LEADERBOARD_LIST_MAX).toBe(10);
  });
});
