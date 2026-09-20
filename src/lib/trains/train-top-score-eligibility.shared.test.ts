import { describe, expect, it } from "vitest";

import { isMemberEligibleForTopScoreTrain } from "@/lib/trains/train-top-score-eligibility.shared";

describe("isMemberEligibleForTopScoreTrain", () => {
  it.each([
    [1, false],
    [2, false],
    [3, true],
    [4, true],
    [5, true],
    [null, false],
    [undefined, false],
  ] as const)("enabled → rank %s eligible=%s", (rank, expected) => {
    expect(isMemberEligibleForTopScoreTrain(rank, true)).toBe(expected);
  });

  it.each([
    [1, false],
    [2, false],
    [3, true],
    [4, false],
    [5, false],
    [null, false],
    [undefined, false],
  ] as const)("disabled → rank %s eligible=%s", (rank, expected) => {
    expect(isMemberEligibleForTopScoreTrain(rank, false)).toBe(expected);
  });
});
