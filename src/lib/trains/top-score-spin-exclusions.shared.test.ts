import { describe, expect, it } from "vitest";

import {
  buildTopScoreSpinExclusionSet,
  filterTopScoreSpinCandidates,
} from "@/lib/trains/top-score-spin-exclusions.shared";

describe("filterTopScoreSpinCandidates", () => {
  const board = [
    { memberId: "a", memberName: "Alice" },
    { memberId: "b", memberName: "Bob" },
    { memberId: "c", memberName: "Carol" },
  ];

  it("returns all candidates when nothing is excluded", () => {
    expect(filterTopScoreSpinCandidates(board, new Set())).toEqual(board);
  });

  it("drops previously drawn members", () => {
    expect(filterTopScoreSpinCandidates(board, new Set(["a", "c"]))).toEqual([
      { memberId: "b", memberName: "Bob" },
    ]);
  });
});

describe("buildTopScoreSpinExclusionSet", () => {
  it("includes stored ids and the current draft conductor", () => {
    expect(
      buildTopScoreSpinExclusionSet({
        storedMemberIds: ["a"],
        currentDraftMemberId: "b",
      }),
    ).toEqual(new Set(["a", "b"]));
  });

  it("ignores blank draft ids", () => {
    expect(
      buildTopScoreSpinExclusionSet({
        storedMemberIds: ["a"],
        currentDraftMemberId: "  ",
      }),
    ).toEqual(new Set(["a"]));
  });
});
