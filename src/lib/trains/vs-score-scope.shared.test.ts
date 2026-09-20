import { describe, expect, it } from "vitest";

import {
  effectiveConductorRuleForTrainDate,
  resolveLeadTimeInheritedVsBoard,
  resolveVsBoardForTrainDate,
  scoreDateForTrainDate,
} from "@/lib/trains/vs-score-scope.shared";

describe("resolveVsBoardForTrainDate", () => {
  it("keeps the train day's Top 1 scope even when the score day is Top 10", () => {
    expect(
      resolveVsBoardForTrainDate({
        trainRule: { kind: "vs_top_n", topN: 1 },
      }),
    ).toEqual({ topN: 1 });
  });

  it("reads the painted scope as-is", () => {
    expect(
      resolveVsBoardForTrainDate({
        trainRule: { kind: "vs_top_n", topN: 10 },
      }),
    ).toEqual({ topN: 10 });
  });

  it("has no board for a non-VS rule", () => {
    expect(
      resolveVsBoardForTrainDate({
        trainRule: { kind: "rank_pool", pool: "r3", draw: "wheel" },
      }),
    ).toBeNull();
  });
});

describe("resolveLeadTimeInheritedVsBoard", () => {
  it("inherits the score day's board on an off-template day", () => {
    expect(
      resolveLeadTimeInheritedVsBoard({
        trainRule: null,
        leadDays: 1,
        scoreDayRule: { kind: "vs_top_n", topN: 10 },
      }),
    ).toEqual({ topN: 10 });
  });

  it("does not inherit when the train day already reads VS", () => {
    expect(
      resolveLeadTimeInheritedVsBoard({
        trainRule: { kind: "vs_top_n", topN: 1 },
        leadDays: 1,
        scoreDayRule: { kind: "vs_top_n", topN: 10 },
      }),
    ).toBeNull();
  });

  it("does not inherit without lead time", () => {
    expect(
      resolveLeadTimeInheritedVsBoard({
        trainRule: null,
        leadDays: 0,
        scoreDayRule: { kind: "vs_top_n", topN: 10 },
      }),
    ).toBeNull();
  });
});

describe("effectiveConductorRuleForTrainDate", () => {
  it("returns the painted rule unchanged", () => {
    expect(
      effectiveConductorRuleForTrainDate({
        trainRule: { kind: "vs_top_n", topN: 1 },
      }),
    ).toEqual({ kind: "vs_top_n", topN: 1 });
  });
});

describe("scoreDateForTrainDate", () => {
  it("shifts the score date by one day plus lead time", () => {
    expect(scoreDateForTrainDate("2026-08-12", 0)).toBe("2026-08-11");
    expect(scoreDateForTrainDate("2026-08-12", 1)).toBe("2026-08-10");
  });
});
