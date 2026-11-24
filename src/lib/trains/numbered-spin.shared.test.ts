import { describe, expect, it } from "vitest";

import {
  buildNumberedWheelCandidates,
  isNumberedSpinFallbackEligible,
  numberedSpinCandidateId,
  resolveMemberAtNumberedRank,
  resolveNumberedSpinPoolSize,
} from "@/lib/trains/numbered-spin.shared";
import type { ConductorRule, VipRule } from "@/lib/trains/rules/catalog.shared";

const EVENT_SOURCE = {
  target: "warzone-duel" as const,
  seriesId: "series-1",
  occurrenceId: "occ-1",
  boardKey: null,
  teamScope: null,
};

describe("resolveNumberedSpinPoolSize", () => {
  it("returns topN for vs_top_n, vr_top_n, event_top_x, and numeric event_scores", () => {
    expect(resolveNumberedSpinPoolSize({ kind: "vs_top_n", topN: 10 })).toBe(10);
    expect(resolveNumberedSpinPoolSize({ kind: "vr_top_n", topN: 3 })).toBe(3);
    expect(
      resolveNumberedSpinPoolSize({
        kind: "event_top_x",
        eventKey: "warzone",
        topN: 5,
      }),
    ).toBe(5);
    expect(
      resolveNumberedSpinPoolSize({
        kind: "event_scores",
        source: EVENT_SOURCE,
        eligibility: "scored",
        topN: 3,
        fallback: "none",
      }),
    ).toBe(3);
  });

  it("returns null for non-Top-N rules and null", () => {
    const unsupported: Array<ConductorRule | VipRule | null> = [
      null,
      { kind: "rank_pool", pool: "r3", draw: "wheel" },
      { kind: "price_is_freight", board: "weekday" },
      { kind: "donations_top" },
      { kind: "donations_second" },
      { kind: "vs_min_score", minScore: 1_000_000 },
      { kind: "none" },
      {
        kind: "event_scores",
        source: EVENT_SOURCE,
        eligibility: "participants",
        topN: "all",
        fallback: "none",
      },
    ];
    for (const rule of unsupported) {
      expect(resolveNumberedSpinPoolSize(rule)).toBeNull();
    }
  });
});

describe("isNumberedSpinFallbackEligible", () => {
  const vsTop10: ConductorRule = { kind: "vs_top_n", topN: 10 };
  const vrTop3: ConductorRule = { kind: "vr_top_n", topN: 3 };
  const eventTop5: ConductorRule = {
    kind: "event_scores",
    source: EVENT_SOURCE,
    eligibility: "scored",
    topN: 5,
    fallback: "none",
  };

  it("allows missing VS, VR, and Event candidates for Top-N rules", () => {
    expect(
      isNumberedSpinFallbackEligible(
        { code: "NO_WHEEL_CANDIDATES", candidateKind: "vs" },
        vsTop10,
      ),
    ).toBe(true);
    expect(
      isNumberedSpinFallbackEligible(
        { code: "NO_WHEEL_CANDIDATES", candidateKind: "vr" },
        vrTop3,
      ),
    ).toBe(true);
    expect(
      isNumberedSpinFallbackEligible(
        { code: "NO_WHEEL_CANDIDATES", candidateKind: "event" },
        eventTop5,
      ),
    ).toBe(true);
    expect(
      isNumberedSpinFallbackEligible({ code: "EVENT_NOT_READY" }, eventTop5),
    ).toBe(true);
    expect(
      isNumberedSpinFallbackEligible({ code: "PENDING_EVIDENCE" }, eventTop5),
    ).toBe(true);
    expect(
      isNumberedSpinFallbackEligible(
        { code: "READINESS_INVALIDATED" },
        eventTop5,
      ),
    ).toBe(true);
  });

  it("rejects day_spin_exhausted, non-score blockers, and non-Top-N rules", () => {
    expect(
      isNumberedSpinFallbackEligible(
        {
          code: "NO_WHEEL_CANDIDATES",
          candidateKind: "vs",
          spinBlockReason: "day_spin_exhausted",
        },
        vsTop10,
      ),
    ).toBe(false);
    expect(
      isNumberedSpinFallbackEligible(
        { code: "POOL_EMPTY", poolType: "r3" },
        vsTop10,
      ),
    ).toBe(false);
    expect(
      isNumberedSpinFallbackEligible(
        { code: "NO_WHEEL_CANDIDATES", candidateKind: "vs" },
        { kind: "price_is_freight", board: "weekday" },
      ),
    ).toBe(false);
    expect(isNumberedSpinFallbackEligible(null, vsTop10)).toBe(false);
  });
});

describe("buildNumberedWheelCandidates", () => {
  it("builds 1..N candidates with deterministic ids and #k labels", () => {
    expect(buildNumberedWheelCandidates(3)).toEqual([
      { memberId: numberedSpinCandidateId(1), memberName: "#1" },
      { memberId: numberedSpinCandidateId(2), memberName: "#2" },
      { memberId: numberedSpinCandidateId(3), memberName: "#3" },
    ]);
    expect(buildNumberedWheelCandidates(0)).toEqual([]);
  });
});

describe("resolveMemberAtNumberedRank", () => {
  const board = [
    { memberId: "m1", memberName: "Alice" },
    { memberId: "m2", memberName: "Bob" },
    { memberId: "m3", memberName: "Cara" },
  ];

  it("resolves 1-based rank and excludes conductor for VIP", () => {
    expect(resolveMemberAtNumberedRank(board, 1)).toEqual(board[0]);
    expect(resolveMemberAtNumberedRank(board, 3)).toEqual(board[2]);
    expect(resolveMemberAtNumberedRank(board, 4)).toBeNull();
    expect(resolveMemberAtNumberedRank(board, 0)).toBeNull();

    // Excluding m1 shifts rank #1 to Bob and rank #2 to Cara
    expect(resolveMemberAtNumberedRank(board, 1, "m1")).toEqual(board[1]);
    expect(resolveMemberAtNumberedRank(board, 2, "m1")).toEqual(board[2]);
    expect(resolveMemberAtNumberedRank(board, 3, "m1")).toBeNull();
  });
});
