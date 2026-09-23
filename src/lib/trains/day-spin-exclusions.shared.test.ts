import { describe, expect, it } from "vitest";

import {
  buildDaySpinExclusionSet,
  filterDaySpinCandidates,
  usesDaySpinExclusions,
} from "@/lib/trains/day-spin-exclusions.shared";

describe("filterDaySpinCandidates", () => {
  const board = [
    { memberId: "a", memberName: "Alice" },
    { memberId: "b", memberName: "Bob" },
    { memberId: "c", memberName: "Carol" },
  ];

  it("returns all candidates when nothing is excluded", () => {
    expect(filterDaySpinCandidates(board, new Set())).toEqual(board);
  });

  it("drops previously drawn members", () => {
    expect(filterDaySpinCandidates(board, new Set(["a", "c"]))).toEqual([
      { memberId: "b", memberName: "Bob" },
    ]);
  });
});

describe("buildDaySpinExclusionSet", () => {
  it("includes stored ids and the current draft conductor", () => {
    expect(
      buildDaySpinExclusionSet({
        storedMemberIds: ["a"],
        currentDraftMemberId: "b",
      }),
    ).toEqual(new Set(["a", "b"]));
  });

  it("ignores blank draft ids", () => {
    expect(
      buildDaySpinExclusionSet({
        storedMemberIds: ["a"],
        currentDraftMemberId: "  ",
      }),
    ).toEqual(new Set(["a"]));
  });
});

describe("usesDaySpinExclusions", () => {
  it("skips deterministic draws", () => {
    // Top 1 resolves to a single member, R4 rotation walks the pool in order.
    expect(
      usesDaySpinExclusions({ rule: { kind: "vs_top_n", topN: 1 } }),
    ).toBe(false);
    expect(
      usesDaySpinExclusions({
        rule: { kind: "rank_pool", pool: "r4_plus", draw: "wheel" },
      }),
    ).toBe(false);
    expect(usesDaySpinExclusions({ rule: { kind: "donations_top" } })).toBe(
      false,
    );
    expect(usesDaySpinExclusions({ rule: null })).toBe(false);
  });

  it("applies to every non-deterministic board", () => {
    expect(
      usesDaySpinExclusions({ rule: { kind: "vs_top_n", topN: 10 } }),
    ).toBe(true);
    expect(
      usesDaySpinExclusions({ rule: { kind: "vr_top_n", topN: 3 } }),
    ).toBe(true);
    expect(
      usesDaySpinExclusions({
        rule: { kind: "rank_pool", pool: "r3", draw: "wheel" },
      }),
    ).toBe(true);
    expect(
      usesDaySpinExclusions({
        rule: { kind: "rank_pool", pool: "heavy_hitter", draw: "wheel" },
      }),
    ).toBe(true);
    expect(
      usesDaySpinExclusions({
        rule: { kind: "price_is_freight", board: "weekday" },
      }),
    ).toBe(true);
    expect(
      usesDaySpinExclusions({
        rule: { kind: "price_is_freight", board: "heavy_hitter" },
      }),
    ).toBe(true);
  });
});
