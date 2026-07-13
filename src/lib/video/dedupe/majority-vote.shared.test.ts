import { describe, expect, it } from "vitest";

import { resolveByMajority } from "@/lib/video/dedupe/majority-vote.shared";

describe("resolveByMajority", () => {
  it("returns null when all values are missing", () => {
    expect(resolveByMajority([null, undefined])).toBeNull();
  });

  it("returns the unanimous value when every value already agrees", () => {
    expect(resolveByMajority([6000, 6000, 6000])).toEqual({
      value: 6000,
      agreeCount: 3,
      totalCount: 3,
    });
  });

  it("resolves a clear majority (5 of 6)", () => {
    const result = resolveByMajority([6000, 6000, 6000, 6000, 6000, 5000]);
    expect(result).toEqual({ value: 6000, agreeCount: 5, totalCount: 6 });
  });

  it("resolves a 4-of-5 majority", () => {
    const result = resolveByMajority([1, 1, 1, 1, 3]);
    expect(result).toEqual({ value: 1, agreeCount: 4, totalCount: 5 });
  });

  it("does not resolve a bare 1-of-2 split", () => {
    expect(resolveByMajority(["LFgo", "LFga"])).toBeNull();
  });

  it("does not resolve a 2-2 tie", () => {
    expect(resolveByMajority([1, 1, 3, 3])).toBeNull();
  });

  it("does not resolve when the top group is a plurality but not a strict majority", () => {
    // 2 of 5 is not > 5/2
    expect(resolveByMajority([1, 1, 2, 3, 4])).toBeNull();
  });

  it("supports a custom equality comparator", () => {
    const result = resolveByMajority(
      ["LFgo", "lfgo", "LFGO", "LFga"],
      (a, b) => a.toLowerCase() === b.toLowerCase(),
    );
    expect(result).toEqual({ value: "LFgo", agreeCount: 3, totalCount: 4 });
  });

  it("ignores nulls when counting", () => {
    const result = resolveByMajority([null, 1, 1, undefined, 3]);
    expect(result).toEqual({ value: 1, agreeCount: 2, totalCount: 3 });
  });
});

describe("resolveByMajority — tieBreak", () => {
  const scoreByBatchFrequency = (freq: Record<string, number>) => ({
    score: (value: string) => freq[value] ?? 0,
  });

  it("breaks a 1-of-2 tie when one candidate overwhelmingly dominates an external score", () => {
    const result = resolveByMajority(
      ["LFga", "LFgo"],
      undefined,
      scoreByBatchFrequency({ LFgo: 49, LFga: 3 }),
    );
    expect(result).toEqual({ value: "LFgo", agreeCount: 1, totalCount: 2 });
  });

  it("does not break the tie when the scores are close (not a clear win)", () => {
    const result = resolveByMajority(
      ["AAAA", "BBBB"],
      undefined,
      scoreByBatchFrequency({ AAAA: 5, BBBB: 4 }),
    );
    expect(result).toBeNull();
  });

  it("does not break the tie when neither candidate has any external signal", () => {
    const result = resolveByMajority(
      ["AAAA", "BBBB"],
      undefined,
      scoreByBatchFrequency({}),
    );
    expect(result).toBeNull();
  });

  it("does not trust a dominant score from a tiny batch", () => {
    const result = resolveByMajority(
      ["LFga", "LFgo"],
      undefined,
      scoreByBatchFrequency({ LFgo: 3, LFga: 1 }),
    );
    expect(result).toBeNull();
  });

  it("does not apply a tiebreaker to a plurality that is not locally tied", () => {
    const result = resolveByMajority(
      ["LFgo", "LFgo", "LFga", "LFgb"],
      undefined,
      scoreByBatchFrequency({ LFgo: 100, LFga: 2, LFgb: 1 }),
    );
    expect(result).toBeNull();
  });

  it("honors a domain guard that rejects the externally favored value", () => {
    const result = resolveByMajority(
      ["LFgo", "ROAR"],
      undefined,
      {
        ...scoreByBatchFrequency({ LFgo: 49, ROAR: 1 }),
        canResolve: () => false,
      },
    );
    expect(result).toBeNull();
  });

  it("only considers tiebreak among values tied for the local top count, not lower-count ones", () => {
    // 2 of 3 is already a strict majority — tieBreak should never even be consulted.
    const result = resolveByMajority(
      [1, 1, 2],
      undefined,
      { score: (v) => (v === 2 ? 1000 : 0) },
    );
    expect(result).toEqual({ value: 1, agreeCount: 2, totalCount: 3 });
  });

  it("does not break a tie when no tieBreak is supplied", () => {
    expect(resolveByMajority(["LFga", "LFgo"])).toBeNull();
  });
});
