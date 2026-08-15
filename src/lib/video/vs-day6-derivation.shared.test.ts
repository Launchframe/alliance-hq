import { describe, expect, it } from "vitest";

import {
  deriveVsDay6Score,
  formatVsDay6DerivedScore,
  interpolateVsDay6SubmitPayloads,
  parseVsReviewScoreText,
} from "@/lib/video/vs-day6-derivation.shared";

describe("deriveVsDay6Score", () => {
  const fullCoverage = { total: 100_000_000, daysCovered: 5 };

  it("subtracts Days 1–5 total when all five days are covered", () => {
    expect(deriveVsDay6Score(150_000_000, fullCoverage)).toEqual({
      status: "derived",
      derivedScore: 50_000_000,
    });
  });

  it("allows a negative Day 6 delta when cumulative is below prior days", () => {
    expect(deriveVsDay6Score(80_000_000, fullCoverage)).toEqual({
      status: "derived",
      derivedScore: -20_000_000,
    });
  });

  it("returns insufficient_data when fewer than five days are covered", () => {
    expect(
      deriveVsDay6Score(150_000_000, { total: 80_000_000, daysCovered: 4 }),
    ).toEqual({ status: "insufficient_data" });
    expect(
      deriveVsDay6Score(150_000_000, { total: 0, daysCovered: 0 }),
    ).toEqual({ status: "insufficient_data" });
  });

  it("returns insufficient_data when coverage is missing", () => {
    expect(deriveVsDay6Score(150_000_000, undefined)).toEqual({
      status: "insufficient_data",
    });
  });
});

describe("parseVsReviewScoreText", () => {
  it("parses comma-separated numbers", () => {
    expect(parseVsReviewScoreText("12,345,678")).toBe(12_345_678);
  });

  it("returns null for empty or invalid input", () => {
    expect(parseVsReviewScoreText("")).toBeNull();
    expect(parseVsReviewScoreText(null)).toBeNull();
    expect(parseVsReviewScoreText("n/a")).toBeNull();
  });
});

describe("formatVsDay6DerivedScore", () => {
  it("rounds to an integer string", () => {
    expect(formatVsDay6DerivedScore(50_000_000.4)).toBe("50000000");
  });
});

describe("interpolateVsDay6SubmitPayloads", () => {
  const fullCoverage = new Map([
    ["m1", { total: 100_000_000, daysCovered: 5 }],
    ["m2", { total: 40_000_000, daysCovered: 4 }],
  ]);

  it("replaces weekly scores with Day 6 deltas for fully covered members", () => {
    expect(
      interpolateVsDay6SubmitPayloads(
        [
          {
            alliance_id: "a1",
            member_id: "m1",
            member_name: "Alice",
            score: 150_000_000,
          },
          {
            alliance_id: "a1",
            member_id: "m2",
            member_name: "Bob",
            score: 80_000_000,
          },
        ],
        fullCoverage,
      ),
    ).toEqual([
      {
        alliance_id: "a1",
        member_id: "m1",
        member_name: "Alice",
        score: 50_000_000,
      },
    ]);
  });
});
