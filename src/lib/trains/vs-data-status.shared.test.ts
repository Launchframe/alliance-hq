import { describe, expect, it } from "vitest";

import type { ConductorRule } from "@/lib/trains/rules/catalog.shared";
import {
  buildVsDataStatus,
  classifyVsDataNeed,
  priorDayVsAppliesForTrainDate,
  scoreDayRuleUsesPriorDayVsScores,
  shouldConfirmEconomyWeekWithoutScores,
} from "@/lib/trains/vs-data-status.shared";

const R3_WHEEL: ConductorRule = { kind: "rank_pool", pool: "r3", draw: "wheel" };
const R4: ConductorRule = { kind: "rank_pool", pool: "r4_plus", draw: "wheel" };

describe("priorDayVsAppliesForTrainDate", () => {
  it("applies on Sunday train days (Saturday Buster Day scores)", () => {
    expect(priorDayVsAppliesForTrainDate("2026-06-14")).toBe(true);
  });

  it("does not apply on Monday train days (Sunday VS break)", () => {
    expect(priorDayVsAppliesForTrainDate("2026-06-15")).toBe(false);
  });

  it("applies on Monday train days when leadDays=1 (Saturday scores)", () => {
    expect(priorDayVsAppliesForTrainDate("2026-06-15", 1)).toBe(true);
  });
});

describe("classifyVsDataNeed", () => {
  it("requires prior-day VS for a Top VS board", () => {
    for (const topN of [1, 3, 5, 10] as const) {
      expect(
        classifyVsDataNeed({
          rule: { kind: "vs_top_n", topN },
          trainDate: "2026-06-13",
        }),
      ).toEqual({ kind: "prior_day_vs", required: true });
    }
  });

  it("requires season VR for a Top VR board", () => {
    expect(
      classifyVsDataNeed({ rule: { kind: "vr_top_n", topN: 3 } }),
    ).toEqual({ kind: "vr", required: true });
  });

  it("requires prior-day VS for both Price Is Freight boards", () => {
    expect(
      classifyVsDataNeed({
        rule: { kind: "price_is_freight", board: "weekday" },
        trainDate: "2026-06-13",
      }),
    ).toEqual({ kind: "prior_day_vs", required: true });
    expect(
      classifyVsDataNeed({
        rule: { kind: "price_is_freight", board: "heavy_hitter" },
        trainDate: "2026-06-13",
      }),
    ).toEqual({ kind: "prior_day_vs", required: true });
  });

  it("probes prior-day VS for the R3 wheel without requiring an upload", () => {
    expect(
      classifyVsDataNeed({ rule: R3_WHEEL, trainDate: "2026-06-13" }),
    ).toEqual({ kind: "prior_day_vs", required: false });
    expect(
      classifyVsDataNeed({ rule: R3_WHEEL, trainDate: "2026-06-14" }),
    ).toEqual({ kind: "prior_day_vs", required: false });
  });

  it("does not require scores for the manual R3 award", () => {
    expect(
      classifyVsDataNeed({
        rule: { kind: "rank_pool", pool: "r3", draw: "manual" },
        trainDate: "2026-06-14",
      }),
    ).toEqual({ kind: "none", required: false });
  });

  it("does not require scores for R4 rotation or free choice", () => {
    expect(
      classifyVsDataNeed({ rule: R4, trainDate: "2026-06-13" }),
    ).toEqual({ kind: "none", required: false });
    expect(
      classifyVsDataNeed({ rule: null, trainDate: "2026-06-13" }),
    ).toEqual({ kind: "none", required: false });
  });

  it("skips prior-day VS when the source day is the VS break", () => {
    // Monday at lead 0 reads Sunday.
    expect(
      classifyVsDataNeed({
        rule: { kind: "vs_top_n", topN: 10 },
        trainDate: "2026-06-15",
      }),
    ).toEqual({ kind: "none", required: false });
  });

  it("inherits the score day's VS context on an off-template day", () => {
    expect(
      classifyVsDataNeed({
        rule: R4,
        trainDate: "2026-06-15",
        leadDays: 1,
        scoreDayRule: { kind: "vs_top_n", topN: 10 },
      }),
    ).toEqual({ kind: "prior_day_vs", required: false });
  });
});

describe("scoreDayRuleUsesPriorDayVsScores", () => {
  it("is true for VS-sourced rules only", () => {
    expect(
      scoreDayRuleUsesPriorDayVsScores({ kind: "vs_top_n", topN: 10 }),
    ).toBe(true);
    expect(
      scoreDayRuleUsesPriorDayVsScores({
        kind: "price_is_freight",
        board: "weekday",
      }),
    ).toBe(true);
    expect(scoreDayRuleUsesPriorDayVsScores(R4)).toBe(false);
    expect(scoreDayRuleUsesPriorDayVsScores(null)).toBe(false);
  });
});

describe("shouldConfirmEconomyWeekWithoutScores", () => {
  it("prompts only for the R3 wheel with a zero score probe", () => {
    expect(
      shouldConfirmEconomyWeekWithoutScores({
        rule: R3_WHEEL,
        vsDataStatus: { kind: "prior_day_vs", scoreCount: 0 },
      }),
    ).toBe(true);
  });

  it("does not prompt when scores exist", () => {
    expect(
      shouldConfirmEconomyWeekWithoutScores({
        rule: R3_WHEEL,
        vsDataStatus: { kind: "prior_day_vs", scoreCount: 4 },
      }),
    ).toBe(false);
  });

  it("does not prompt for the manual R3 award", () => {
    expect(
      shouldConfirmEconomyWeekWithoutScores({
        rule: { kind: "rank_pool", pool: "r3", draw: "manual" },
        vsDataStatus: { kind: "prior_day_vs", scoreCount: 0 },
      }),
    ).toBe(false);
  });
});

describe("buildVsDataStatus", () => {
  it("is ready when scores are not required", () => {
    expect(
      buildVsDataStatus({ kind: "none", required: false, scoreCount: 0 }),
    ).toEqual({ kind: "none", required: false, ready: true, scoreCount: 0 });
  });

  it("is not ready when required scores are missing", () => {
    expect(
      buildVsDataStatus({
        kind: "prior_day_vs",
        required: true,
        scoreCount: 0,
        scoreDate: "2026-06-12",
      }).ready,
    ).toBe(false);
  });
});
