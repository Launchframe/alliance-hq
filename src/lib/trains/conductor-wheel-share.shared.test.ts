import { describe, expect, it } from "vitest";

import {
  formatWheelShareEligibilityLine,
  formatWheelShareScore,
  formatWheelShareWinChance,
  resolveWheelShareEligibility,
  winProbabilityFromTicketPool,
} from "@/lib/trains/conductor-wheel-share.shared";

const labels = {
  vsMinimum: (score: string, minimum: string) =>
    `Eligible: ${score} (min ${minimum})`,
  tpif: (score: string, sweetSpot: string) =>
    `Prior-day VS ${score} — closest to ${sweetSpot}`,
  tpifWithChance: (score: string, chance: string) =>
    `Prior-day VS ${score} · ${chance} win chance`,
  vsLeaderboardRank: (rank: number, score: string, suffix: string) =>
    `#${rank} · ${score} ${suffix}`,
  vsLeaderboardScore: (score: string, suffix: string) => `${score} ${suffix}`,
};

describe("resolveWheelShareEligibility", () => {
  it("prefers qualified conductor minimums proof", () => {
    const eligibility = resolveWheelShareEligibility({
      mechanism: "r3_lottery",
      paintTemplate: "economy_week",
      winner: { memberId: "a", memberName: "Alpha", priorDayVsScore: 7_500_000 },
      qualification: {
        qualified: true,
        evaluationWindow: "weekly",
        periodStart: "2026-07-14",
        periodEnd: "2026-07-20",
        vs: {
          score: 7_500_000,
          minimum: 7_200_000,
          effectiveMinimum: 7_200_000,
          shortfall: 0,
        },
        donation: {
          score: 0,
          minimum: 0,
          effectiveMinimum: 0,
          shortfall: 0,
        },
      },
    });
    expect(eligibility).toEqual({
      kind: "vs_minimum",
      score: 7_500_000,
      minimum: 7_200_000,
    });
  });

  it("uses TPIF framing with win chance when provided", () => {
    const eligibility = resolveWheelShareEligibility({
      mechanism: "r3_lottery",
      paintTemplate: "price_is_right",
      winner: { memberId: "a", memberName: "Alpha", priorDayVsScore: 7_230_000 },
      winProbability: 0.127,
    });
    expect(eligibility).toEqual({
      kind: "tpif",
      score: 7_230_000,
      sweetSpot: 7_200_000,
      winProbability: 0.127,
    });
    expect(formatWheelShareEligibilityLine(eligibility, labels, "en-US")).toBe(
      "Prior-day VS 7.2M pts · 12.7% win chance",
    );
  });

  it("uses VS leaderboard proof with explicit scoreboard rank only", () => {
    const eligibility = resolveWheelShareEligibility({
      mechanism: "vs_top_10",
      paintTemplate: "vs_push_weekdays",
      winner: {
        memberId: "a",
        memberName: "Alpha",
        priorDayVsScore: 8_500_000,
      },
      leaderboardRank: 2,
    });
    expect(eligibility).toEqual({
      kind: "vs_leaderboard",
      score: 8_500_000,
      suffix: "VS",
      rank: 2,
    });
    expect(formatWheelShareEligibilityLine(eligibility, labels)).toBe(
      "#2 · 8.5M VS",
    );
  });

  it("does not treat alliance R-rank as scoreboard rank", () => {
    const eligibility = resolveWheelShareEligibility({
      mechanism: "vs_top_10",
      paintTemplate: "vs_push_weekdays",
      winner: {
        memberId: "a",
        memberName: "Alpha",
        priorDayVsScore: 8_500_000,
      },
    });
    expect(eligibility).toEqual({
      kind: "vs_leaderboard",
      score: 8_500_000,
      suffix: "VS",
      rank: null,
    });
  });
});

describe("winProbabilityFromTicketPool", () => {
  it("returns null when the pool has no tickets", () => {
    expect(
      winProbabilityFromTicketPool(
        [{ memberId: "a", ticketCount: 0 }],
        "a",
      ),
    ).toBeNull();
  });

  it("computes winner share of total tickets", () => {
    expect(
      winProbabilityFromTicketPool(
        [
          { memberId: "a", ticketCount: 100 },
          { memberId: "b", ticketCount: 300 },
        ],
        "a",
      ),
    ).toBeCloseTo(0.25);
  });
});

describe("formatWheelShareScore", () => {
  it("formats millions with one decimal when needed", () => {
    expect(formatWheelShareScore(7_250_000)).toBe("7.3M");
    expect(formatWheelShareScore(7_200_000)).toBe("7.2M");
  });

  it("formats win chance as a percent", () => {
    expect(formatWheelShareWinChance(0.127, "en-US")).toBe("12.7%");
  });
});
