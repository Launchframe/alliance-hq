import { describe, expect, it, vi } from "vitest";

import {
  buildEqualChanceOddsBoard,
  buildUniformEconomyDrawSet,
  pickUniformRollCandidate,
  pickWeightedRollCandidate,
} from "@/lib/trains/price-is-freight-roll.shared";

describe("pickWeightedRollCandidate", () => {
  it("never picks zero-ticket candidates", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const winner = pickWeightedRollCandidate([
      { memberId: "a", memberName: "A", ticketCount: 0 },
      { memberId: "b", memberName: "B", ticketCount: 10 },
    ]);
    expect(winner?.memberId).toBe("b");
    vi.restoreAllMocks();
  });
});

describe("pickUniformRollCandidate", () => {
  it("can return the same candidate on consecutive rolls (with-replacement)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const candidates = [
      { memberId: "a", memberName: "A" },
      { memberId: "b", memberName: "B" },
    ];
    expect(pickUniformRollCandidate(candidates)?.memberId).toBe("a");
    expect(pickUniformRollCandidate(candidates)?.memberId).toBe("a");
    vi.restoreAllMocks();
  });
});

describe("buildEqualChanceOddsBoard", () => {
  it("assigns equal probabilities that sum to ~1", () => {
    const board = buildEqualChanceOddsBoard([
      { memberId: "a", memberName: "Alpha" },
      { memberId: "b", memberName: "Bravo" },
      { memberId: "c", memberName: "Charlie" },
    ]);
    expect(board).toHaveLength(3);
    const sum = board.reduce((n, row) => n + row.winProbability, 0);
    expect(sum).toBeCloseTo(1, 8);
    expect(board.every((row) => row.winProbability === 1 / 3)).toBe(true);
  });
});

describe("buildUniformEconomyDrawSet", () => {
  it("keeps takedown overrides above the band and excludes out-of-band R3", () => {
    const { eligible, excluded } = buildUniformEconomyDrawSet({
      candidates: [
        { memberId: "in", memberName: "InBand" },
        { memberId: "high", memberName: "HighOverride" },
        { memberId: "low", memberName: "Low" },
      ],
      scores: new Map([
        ["in", 7_500_000],
        ["high", 20_000_000],
        ["low", 1_000_000],
      ]),
      settings: { thresholdPoints: 8_500_000, fudgePct: 1 },
      maxTicketMemberIds: ["high"],
    });

    expect(eligible.map((e) => e.memberId).sort()).toEqual(["high", "in"]);
    expect(excluded.map((e) => e.memberId)).toEqual(["low"]);
    expect(eligible.every((e) => e.winProbability === 0.5)).toBe(true);
  });
});
