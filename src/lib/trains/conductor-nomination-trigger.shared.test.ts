import { describe, expect, it } from "vitest";

import { resolveConductorNominationTrigger } from "@/lib/trains/conductor-nomination-trigger.shared";

describe("resolveConductorNominationTrigger", () => {
  it("marks Wed VS top-1 with lead=1 as score_upload on Monday scores", () => {
    // 2026-06-10 = Wed; lead 1 → scoreDate = Mon 2026-06-08
    const trigger = resolveConductorNominationTrigger({
      conductorMechanism: "vs_high_score",
      paintTemplate: "vs_push_weekdays",
      trainDate: "2026-06-10",
      leadDays: 1,
    });
    expect(trigger).toEqual({
      mode: "score_upload",
      kind: "prior_day_vs",
      scoreDate: "2026-06-08",
    });
  });

  it("marks economy week R3 as scheduled_reset", () => {
    const trigger = resolveConductorNominationTrigger({
      conductorMechanism: "r3_lottery",
      paintTemplate: "economy_week",
      trainDate: "2026-06-11",
      leadDays: 1,
    });
    expect(trigger).toEqual({
      mode: "scheduled_reset",
      anchor: "day_before_train",
    });
  });

  it("marks r3_recognition as manual", () => {
    const trigger = resolveConductorNominationTrigger({
      conductorMechanism: "r3_lottery",
      paintTemplate: "r3_recognition",
      trainDate: "2026-06-11",
    });
    expect(trigger).toEqual({ mode: "manual" });
  });
});

  it("inherits score_upload from score reference day under lead time", () => {
    const trigger = resolveConductorNominationTrigger({
      conductorMechanism: "r4_sequence",
      paintTemplate: "r4_train_week",
      trainDate: "2026-06-14",
      leadDays: 1,
      scoreDateDay: { conductorMechanism: "vs_top_10" },
    });
    expect(trigger).toEqual({
      mode: "score_upload",
      kind: "prior_day_vs",
      scoreDate: "2026-06-12",
    });
  });
