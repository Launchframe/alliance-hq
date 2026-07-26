import { describe, expect, it } from "vitest";

import {
  formatWheelShareEligibilityLine,
  formatWheelShareScore,
  resolveWheelShareEligibility,
} from "@/lib/trains/conductor-wheel-share.shared";

const labels = {
  vsMinimum: (score: string, minimum: string) =>
    `Eligible: ${score} (min ${minimum})`,
  tpif: (score: string, sweetSpot: string) =>
    `Prior-day VS ${score} — closest to ${sweetSpot}`,
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

  it("uses TPIF framing for price is right days", () => {
    const eligibility = resolveWheelShareEligibility({
      mechanism: "r3_lottery",
      paintTemplate: "price_is_right",
      winner: { memberId: "a", memberName: "Alpha", priorDayVsScore: 7_230_000 },
    });
    expect(eligibility).toEqual({
      kind: "tpif",
      score: 7_230_000,
      sweetSpot: 7_200_000,
    });
  });

  it("uses VS leaderboard proof with rank when available", () => {
    const eligibility = resolveWheelShareEligibility({
      mechanism: "vs_top_10",
      paintTemplate: "vs_push_weekdays",
      winner: {
        memberId: "a",
        memberName: "Alpha",
        priorDayVsScore: 8_500_000,
        allianceRank: 3,
      },
    });
    expect(eligibility).toEqual({
      kind: "vs_leaderboard",
      score: 8_500_000,
      suffix: "VS",
      rank: 3,
    });
    expect(
      formatWheelShareEligibilityLine(eligibility, labels),
    ).toBe("#3 · 8.5M VS");
  });
});

describe("formatWheelShareScore", () => {
  it("formats millions with one decimal when needed", () => {
    expect(formatWheelShareScore(7_250_000)).toBe("7.3M");
    expect(formatWheelShareScore(7_200_000)).toBe("7.2M");
  });

  it("uses the active locale for sub-thousand grouping", () => {
    expect(formatWheelShareScore(999, "en-US")).toBe("999");
    expect(formatWheelShareScore(999, "pt-BR")).toBe("999");
  });
});
