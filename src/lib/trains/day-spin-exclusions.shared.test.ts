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
  it("skips Top VS / Top VR scope 1", () => {
    expect(
      usesDaySpinExclusions({
        mechanism: "vs_high_score",
        topBoard: { kind: "vs", topN: 1, mechanism: "vs_high_score" },
      }),
    ).toBe(false);
    expect(
      usesDaySpinExclusions({
        mechanism: "vs_top_n",
        topBoard: { kind: "vs", topN: 1, mechanism: "vs_top_n" },
      }),
    ).toBe(false);
  });

  it("applies to Top VS / Top VR scopes greater than 1", () => {
    expect(
      usesDaySpinExclusions({
        mechanism: "vs_top_n",
        topBoard: { kind: "vs", topN: 10, mechanism: "vs_top_n" },
      }),
    ).toBe(true);
    expect(
      usesDaySpinExclusions({
        mechanism: "vr_top_n",
        topBoard: { kind: "vr", topN: 3, mechanism: "vr_top_n" },
      }),
    ).toBe(true);
  });

  it("applies to R3 and heavy-hitter lotteries, not R4 sequence", () => {
    expect(usesDaySpinExclusions({ mechanism: "r3_lottery" })).toBe(true);
    expect(usesDaySpinExclusions({ mechanism: "heavy_hitter_lottery" })).toBe(
      true,
    );
    expect(usesDaySpinExclusions({ mechanism: "r4_sequence" })).toBe(false);
  });

  it("applies to Price Is Freight paint", () => {
    expect(
      usesDaySpinExclusions({
        mechanism: "r3_lottery",
        paintTemplate: "price_is_right",
      }),
    ).toBe(true);
  });
});
