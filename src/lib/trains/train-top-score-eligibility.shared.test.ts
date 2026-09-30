import { describe, expect, it } from "vitest";

import {
  isMemberEligibleForTopScoreTrain,
  normalizeTrainTopScoreMinimumRank,
} from "@/lib/trains/train-top-score-eligibility.shared";

describe("isMemberEligibleForTopScoreTrain", () => {
  it.each([
    [null, true],
    [undefined, true],
    [0, false],
    [1, true],
    [2, true],
    [3, true],
    [4, true],
    [5, true],
    [6, false],
  ] as const)("min 1, R4+ on → rank %s eligible=%s", (rank, expected) => {
    expect(isMemberEligibleForTopScoreTrain(rank, 1, true)).toBe(expected);
  });

  it.each([
    [null, false],
    [undefined, false],
    [0, false],
    [1, false],
    [2, true],
    [3, true],
    [4, true],
    [5, true],
    [6, false],
  ] as const)("min 2, R4+ on → rank %s eligible=%s", (rank, expected) => {
    expect(isMemberEligibleForTopScoreTrain(rank, 2, true)).toBe(expected);
  });

  it.each([
    [null, false],
    [undefined, false],
    [0, false],
    [1, false],
    [2, false],
    [3, true],
    [4, true],
    [5, true],
    [6, false],
  ] as const)("min 3, R4+ on → rank %s eligible=%s", (rank, expected) => {
    expect(isMemberEligibleForTopScoreTrain(rank, 3, true)).toBe(expected);
  });

  it.each([
    [1, true],
    [2, true],
    [3, true],
    [4, false],
    [5, false],
    [null, true],
  ] as const)(
    "min 1, R4+ off → rank %s eligible=%s (toggle independent of minimum)",
    (rank, expected) => {
      expect(isMemberEligibleForTopScoreTrain(rank, 1, false)).toBe(expected);
    },
  );

  it.each([
    [2, true],
    [3, true],
    [4, false],
    [5, false],
  ] as const)("min 2, R4+ off → rank %s eligible=%s", (rank, expected) => {
    expect(isMemberEligibleForTopScoreTrain(rank, 2, false)).toBe(expected);
  });

  it.each([
    [3, true],
    [4, false],
    [5, false],
  ] as const)("min 3, R4+ off → rank %s eligible=%s", (rank, expected) => {
    expect(isMemberEligibleForTopScoreTrain(rank, 3, false)).toBe(expected);
  });
});

describe("normalizeTrainTopScoreMinimumRank", () => {
  it.each([
    [1, 1],
    [2, 2],
    [3, 3],
    [0, 3],
    [4, 3],
    [null, 3],
    [undefined, 3],
    ["2", 3],
  ] as const)("normalizes %s → %s", (input, expected) => {
    expect(normalizeTrainTopScoreMinimumRank(input)).toBe(expected);
  });
});
