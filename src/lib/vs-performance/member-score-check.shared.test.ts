import { describe, expect, it } from "vitest";

import {
  compareVsMemberScores,
  formatVsScoreDifference,
  unavailableVsMemberScoreCheck,
} from "./member-score-check.shared";

describe("compareVsMemberScores", () => {
  it("reports an exact match", () => {
    const check = compareVsMemberScores(
      "100",
      new Map([
        ["m1", 60],
        ["m2", 40],
      ]),
    );
    expect(check).toEqual({
      status: "match",
      confirmedTotal: "100",
      uploadedTotal: "100",
      difference: "0",
      memberCount: 2,
    });
  });

  it("reports a shortfall and an excess with signed differences", () => {
    expect(
      compareVsMemberScores(
        "100",
        new Map([
          ["m1", 60],
          ["m2", 30],
        ]),
      ).status,
    ).toBe("shortfall");
    expect(
      compareVsMemberScores(
        "100",
        new Map([
          ["m1", 60],
          ["m2", 30],
        ]),
      ).difference,
    ).toBe("10");
    const excess = compareVsMemberScores(
      "100",
      new Map([
        ["m1", 60],
        ["m2", 50],
      ]),
    );
    expect(excess.status).toBe("excess");
    expect(excess.difference).toBe("-10");
  });

  it("returns missing for an empty map even when the total is zero", () => {
    expect(compareVsMemberScores("0", new Map())).toEqual({
      status: "missing",
      confirmedTotal: "0",
      uploadedTotal: null,
      difference: null,
      memberCount: 0,
    });
  });

  it("compares huge totals exactly", () => {
    const check = compareVsMemberScores(
      "9007199254740993",
      new Map([["m1", 9007199254740991]]),
    );
    expect(check.status).toBe("shortfall");
    expect(check.difference).toBe("2");
  });

  it("rejects unsafe member scores", () => {
    expect(() =>
      compareVsMemberScores("10", new Map([["m1", 1.5]])),
    ).toThrow();
    expect(() =>
      compareVsMemberScores("10", new Map([["m1", -5]])),
    ).toThrow();
  });
});

describe("unavailableVsMemberScoreCheck", () => {
  it("marks the check unavailable without touching the confirmed total", () => {
    expect(unavailableVsMemberScoreCheck("55")).toEqual({
      status: "unavailable",
      confirmedTotal: "55",
      uploadedTotal: null,
      difference: null,
      memberCount: 0,
    });
  });
});

describe("formatVsScoreDifference", () => {
  it("formats a signed difference for the locale", () => {
    expect(formatVsScoreDifference("10", "en-US")).toBe("+10");
    expect(formatVsScoreDifference("-10", "en-US")).toBe("-10");
    expect(formatVsScoreDifference("0", "en-US")).toBe("+0");
  });
});
