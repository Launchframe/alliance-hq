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
