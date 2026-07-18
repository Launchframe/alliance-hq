import { describe, expect, it } from "vitest";

import {
  buildVsDataStatus,
  classifyVsDataNeed,
} from "@/lib/trains/vs-data-status.shared";

describe("classifyVsDataNeed", () => {
  it("requires VR for vs_high_score and vs_top_10", () => {
    expect(
      classifyVsDataNeed({ conductorMechanism: "vs_high_score" }),
    ).toEqual({ kind: "vr", required: true });
    expect(classifyVsDataNeed({ conductorMechanism: "vs_top_10" })).toEqual({
      kind: "vr",
      required: true,
    });
  });

  it("requires prior-day VS for Price Is Freight paint", () => {
    expect(
      classifyVsDataNeed({
        conductorMechanism: "r3_lottery",
        paintTemplate: "price_is_right",
      }),
    ).toEqual({ kind: "prior_day_vs", required: true });
  });

  it("prefers VR mechanism over paint template when both apply", () => {
    expect(
      classifyVsDataNeed({
        conductorMechanism: "vs_high_score",
        paintTemplate: "price_is_right",
      }),
    ).toEqual({ kind: "vr", required: true });
  });

  it("returns none when scores are not needed", () => {
    expect(
      classifyVsDataNeed({
        conductorMechanism: "r3_lottery",
        paintTemplate: "economy_week",
      }),
    ).toEqual({ kind: "none", required: false });
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
});
