import { describe, expect, it } from "vitest";

import { resolveConductorNominationTrigger } from "@/lib/trains/conductor-nomination-trigger.shared";

describe("resolveConductorNominationTrigger", () => {
  it("marks a Wednesday VS board with lead 1 as score_upload on Monday scores", () => {
    // 2026-06-10 = Wed; lead 1 → scoreDate = Mon 2026-06-08
    expect(
      resolveConductorNominationTrigger({
        rule: { kind: "vs_top_n", topN: 1 },
        trainDate: "2026-06-10",
        leadDays: 1,
      }),
    ).toEqual({
      mode: "score_upload",
      kind: "prior_day_vs",
      scoreDate: "2026-06-08",
    });
  });

  it("marks the R3 wheel as scheduled_reset", () => {
    expect(
      resolveConductorNominationTrigger({
        rule: { kind: "rank_pool", pool: "r3", draw: "wheel" },
        trainDate: "2026-06-11",
        leadDays: 1,
      }),
    ).toEqual({ mode: "scheduled_reset", anchor: "day_before_train" });
  });

  it("marks the manual R3 award as manual", () => {
    expect(
      resolveConductorNominationTrigger({
        rule: { kind: "rank_pool", pool: "r3", draw: "manual" },
        trainDate: "2026-06-11",
      }),
    ).toEqual({ mode: "manual" });
  });

  it("marks free choice as manual", () => {
    expect(
      resolveConductorNominationTrigger({
        rule: null,
        trainDate: "2026-06-11",
      }),
    ).toEqual({ mode: "manual" });
  });

  it("inherits score_upload from the score reference day under lead time", () => {
    expect(
      resolveConductorNominationTrigger({
        rule: { kind: "rank_pool", pool: "r4_plus", draw: "wheel" },
        trainDate: "2026-06-14",
        leadDays: 1,
        scoreDayRule: { kind: "vs_top_n", topN: 10 },
      }),
    ).toEqual({
      mode: "score_upload",
      kind: "prior_day_vs",
      scoreDate: "2026-06-12",
    });
  });
});
