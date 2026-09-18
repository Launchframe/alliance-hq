import { describe, expect, it } from "vitest";

import {
  canSpinConductorWithLeadScope,
  effectiveConductorRuleForTrainDate,
  resolveLeadTimeInheritedVsBoard,
  resolveVsBoardForTrainDate,
} from "@/lib/trains/vs-score-scope.shared";

describe("resolveVsBoardForTrainDate", () => {
  it("uses the score day's VS scope when lead time shifts the source date", () => {
    // Fri (Top 1) with lead 1 reads Wednesday, which is painted Top 10.
    expect(
      resolveVsBoardForTrainDate({
        trainRule: { kind: "vs_top_n", topN: 1 },
        leadDays: 1,
        scoreDayRule: { kind: "vs_top_n", topN: 10 },
      }),
    ).toEqual({ topN: 10 });
  });

  it("keeps the train day's scope when lead time is zero", () => {
    expect(
      resolveVsBoardForTrainDate({
        trainRule: { kind: "vs_top_n", topN: 1 },
        leadDays: 0,
        scoreDayRule: { kind: "vs_top_n", topN: 10 },
      }),
    ).toEqual({ topN: 1 });
  });

  it("has no board for a non-VS rule", () => {
    expect(
      resolveVsBoardForTrainDate({
        trainRule: { kind: "rank_pool", pool: "r3", draw: "wheel" },
        leadDays: 1,
        scoreDayRule: { kind: "vs_top_n", topN: 10 },
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
});

describe("effectiveConductorRuleForTrainDate", () => {
  it("restates the rule at the inherited scope", () => {
    expect(
      effectiveConductorRuleForTrainDate({
        trainRule: { kind: "vs_top_n", topN: 1 },
        leadDays: 1,
        scoreDayRule: { kind: "vs_top_n", topN: 10 },
      }),
    ).toEqual({ kind: "vs_top_n", topN: 10 });
  });
});

describe("canSpinConductorWithLeadScope", () => {
  it("allows a spin when lead time upgrades auto Top 1 to Top 10", () => {
    expect(
      canSpinConductorWithLeadScope({
        rule: { kind: "vs_top_n", topN: 1 },
        locked: false,
        leadDays: 1,
        scoreDayRule: { kind: "vs_top_n", topN: 10 },
      }),
    ).toBe(true);
  });

  it("blocks auto Top 1 without lead time", () => {
    expect(
      canSpinConductorWithLeadScope({
        rule: { kind: "vs_top_n", topN: 1 },
        locked: false,
        leadDays: 0,
        scoreDayRule: { kind: "vs_top_n", topN: 10 },
      }),
    ).toBe(false);
  });

  it("blocks a locked day", () => {
    expect(
      canSpinConductorWithLeadScope({
        rule: { kind: "vs_top_n", topN: 10 },
        locked: true,
      }),
    ).toBe(false);
  });
});
