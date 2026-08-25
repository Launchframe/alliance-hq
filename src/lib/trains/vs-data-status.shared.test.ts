import { describe, expect, it } from "vitest";

import {
  buildVsDataStatus,
  classifyVsDataNeed,
  priorDayVsAppliesForTrainDate,
  shouldConfirmEconomyWeekWithoutScores,
} from "@/lib/trains/vs-data-status.shared";

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
  it("requires prior-day VS for vs_high_score, vs_top_10, and vs_top_n", () => {
    expect(
      classifyVsDataNeed({
        conductorMechanism: "vs_high_score",
        trainDate: "2026-06-13",
      }),
    ).toEqual({ kind: "prior_day_vs", required: true });
    expect(
      classifyVsDataNeed({
        conductorMechanism: "vs_top_10",
        trainDate: "2026-06-13",
      }),
    ).toEqual({
      kind: "prior_day_vs",
      required: true,
    });
    expect(
      classifyVsDataNeed({
        conductorMechanism: "vs_top_n",
        trainDate: "2026-06-13",
      }),
    ).toEqual({
      kind: "prior_day_vs",
      required: true,
    });
  });

  it("requires season VR for vr_top_n", () => {
    expect(classifyVsDataNeed({ conductorMechanism: "vr_top_n" })).toEqual({
      kind: "vr",
      required: true,
    });
  });

  it("requires prior-day VS for Price Is Freight paint", () => {
    expect(
      classifyVsDataNeed({
        conductorMechanism: "r3_lottery",
        paintTemplate: "price_is_right",
        trainDate: "2026-06-13",
      }),
    ).toEqual({ kind: "prior_day_vs", required: true });
    expect(
      classifyVsDataNeed({
        conductorMechanism: "r3_lottery",
        paintTemplate: "takedown_week",
        trainDate: "2026-06-13",
      }),
    ).toEqual({ kind: "prior_day_vs", required: true });
  });

  it("keeps prior-day VS when vs_* mechanism and PIF paint both apply", () => {
    expect(
      classifyVsDataNeed({
        conductorMechanism: "vs_high_score",
        paintTemplate: "price_is_right",
        trainDate: "2026-06-13",
      }),
    ).toEqual({ kind: "prior_day_vs", required: true });
  });

  it("probes prior-day VS for economy week paint without requiring an upload", () => {
    expect(
      classifyVsDataNeed({
        conductorMechanism: "r3_lottery",
        paintTemplate: "economy_week",
        trainDate: "2026-06-13",
      }),
    ).toEqual({ kind: "prior_day_vs", required: false });
  });

  it("probes Saturday VS for economy week on Sunday without requiring an upload", () => {
    expect(
      classifyVsDataNeed({
        conductorMechanism: "r3_lottery",
        paintTemplate: "economy_week",
        trainDate: "2026-06-14",
      }),
    ).toEqual({ kind: "prior_day_vs", required: false });
  });

  it("does not require scores for r3 recognition manual award days", () => {
    expect(
      classifyVsDataNeed({
        conductorMechanism: "r3_lottery",
        paintTemplate: "r3_recognition",
        trainDate: "2026-06-14",
      }),
    ).toEqual({ kind: "none", required: false });
  });

  it("does not require prior-day VS for r4 sequence on economy week paint", () => {
    expect(
      classifyVsDataNeed({
        conductorMechanism: "r4_sequence",
        paintTemplate: "economy_week",
        trainDate: "2026-06-13",
      }),
    ).toEqual({ kind: "none", required: false });
  });

  it("skips prior-day VS on Monday for every conductor mechanism", () => {
    expect(
      classifyVsDataNeed({
        conductorMechanism: "vs_high_score",
        trainDate: "2026-06-15",
      }),
    ).toEqual({ kind: "none", required: false });
    expect(
      classifyVsDataNeed({
        conductorMechanism: "r3_lottery",
        paintTemplate: "economy_week",
        trainDate: "2026-06-15",
      }),
    ).toEqual({ kind: "none", required: false });
    expect(
      classifyVsDataNeed({
        conductorMechanism: "heavy_hitter_lottery",
        paintTemplate: "price_is_right",
        trainDate: "2026-06-15",
      }),
    ).toEqual({ kind: "none", required: false });
  });

  it("requires prior-day VS on Monday when leadDays=1", () => {
    expect(
      classifyVsDataNeed({
        conductorMechanism: "vs_high_score",
        trainDate: "2026-06-15",
        leadDays: 1,
      }),
    ).toEqual({ kind: "prior_day_vs", required: true });
    expect(
      classifyVsDataNeed({
        conductorMechanism: "heavy_hitter_lottery",
        paintTemplate: "price_is_right",
        trainDate: "2026-06-15",
        leadDays: 1,
      }),
    ).toEqual({ kind: "prior_day_vs", required: true });
  });

  it("still requires VR on Monday for vr_top_n", () => {
    expect(
      classifyVsDataNeed({
        conductorMechanism: "vr_top_n",
        trainDate: "2026-06-15",
      }),
    ).toEqual({ kind: "vr", required: true });
  });
});

describe("buildVsDataStatus", () => {
  it("marks ready when not required", () => {
    expect(
      buildVsDataStatus({ kind: "none", required: false, scoreCount: 0 }),
    ).toEqual({
      required: false,
      ready: true,
      scoreCount: 0,
      kind: "none",
    });
  });

  it("marks ready when required and scores exist", () => {
    expect(
      buildVsDataStatus({
        kind: "vr",
        required: true,
        scoreCount: 3,
      }),
    ).toMatchObject({ required: true, ready: true, scoreCount: 3, kind: "vr" });
  });

  it("marks not ready when required and empty", () => {
    expect(
      buildVsDataStatus({
        kind: "prior_day_vs",
        required: true,
        scoreCount: 0,
        scoreDate: "2026-06-12",
      }),
    ).toEqual({
      required: true,
      ready: false,
      scoreCount: 0,
      kind: "prior_day_vs",
      scoreDate: "2026-06-12",
    });
  });

  it("marks ready when prior-day VS is optional and empty", () => {
    expect(
      buildVsDataStatus({
        kind: "prior_day_vs",
        required: false,
        scoreCount: 0,
        scoreDate: "2026-06-12",
      }),
    ).toEqual({
      required: false,
      ready: true,
      scoreCount: 0,
      kind: "prior_day_vs",
      scoreDate: "2026-06-12",
    });
  });
});

describe("shouldConfirmEconomyWeekWithoutScores", () => {
  it("prompts when Economy Week probed prior-day VS and found none", () => {
    expect(
      shouldConfirmEconomyWeekWithoutScores({
        paintTemplate: "economy_week",
        vsDataStatus: { kind: "prior_day_vs", scoreCount: 0 },
      }),
    ).toBe(true);
  });

  it("does not prompt when scores exist or paint is not Economy Week", () => {
    expect(
      shouldConfirmEconomyWeekWithoutScores({
        paintTemplate: "economy_week",
        vsDataStatus: { kind: "prior_day_vs", scoreCount: 4 },
      }),
    ).toBe(false);
    expect(
      shouldConfirmEconomyWeekWithoutScores({
        paintTemplate: "price_is_right",
        vsDataStatus: { kind: "prior_day_vs", scoreCount: 0 },
      }),
    ).toBe(false);
    expect(
      shouldConfirmEconomyWeekWithoutScores({
        paintTemplate: "economy_week",
        vsDataStatus: { kind: "none", scoreCount: 0 },
      }),
    ).toBe(false);
  });
});
