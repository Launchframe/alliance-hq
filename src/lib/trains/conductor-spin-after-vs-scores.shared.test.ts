import { describe, expect, it } from "vitest";

import {
  parseConductorSpinOfferPayload,
  shouldOfferConductorSpinAfterVsScores,
} from "@/lib/trains/conductor-spin-after-vs-scores.shared";
import { scoreDateForTrainDay } from "@/lib/trains/train-day-context.shared";

describe("shouldOfferConductorSpinAfterVsScores", () => {
  const saturdayTrain = "2026-06-13";
  const fridayScores = "2026-06-12";

  it("offers a spin when today's vs_top_10 train needs the submitted daily scores", () => {
    expect(
      shouldOfferConductorSpinAfterVsScores({
        vsPeriod: "daily",
        vsRecordedDate: fridayScores,
        todayTrainDate: saturdayTrain,
        conductorMechanism: "vs_top_10",
      }),
    ).toBe(true);
  });

  it("skips weekly VS totals", () => {
    expect(
      shouldOfferConductorSpinAfterVsScores({
        vsPeriod: "weekly",
        vsRecordedDate: fridayScores,
        todayTrainDate: saturdayTrain,
        conductorMechanism: "vs_top_10",
      }),
    ).toBe(false);
  });

  it("skips when the score date is not today's lead-adjusted reference date", () => {
    expect(
      shouldOfferConductorSpinAfterVsScores({
        vsRecordedDate: "2026-06-11",
        todayTrainDate: saturdayTrain,
        conductorMechanism: "vs_top_10",
      }),
    ).toBe(false);
  });

  it("looks back T−1−leadDays, not always yesterday", () => {
    const mondayTrain = "2026-06-15";
    expect(scoreDateForTrainDay(mondayTrain, 0)).toBe("2026-06-14");
    expect(scoreDateForTrainDay(mondayTrain, 1)).toBe("2026-06-13");
    expect(scoreDateForTrainDay(mondayTrain, 4)).toBe("2026-06-10");

    expect(
      shouldOfferConductorSpinAfterVsScores({
        vsRecordedDate: "2026-06-14",
        todayTrainDate: mondayTrain,
        leadDays: 0,
        conductorMechanism: "vs_top_10",
      }),
    ).toBe(false);

    expect(
      shouldOfferConductorSpinAfterVsScores({
        vsRecordedDate: "2026-06-14",
        todayTrainDate: mondayTrain,
        leadDays: 1,
        conductorMechanism: "vs_top_10",
      }),
    ).toBe(false);

    expect(
      shouldOfferConductorSpinAfterVsScores({
        vsRecordedDate: "2026-06-13",
        todayTrainDate: mondayTrain,
        leadDays: 1,
        conductorMechanism: "vs_top_10",
      }),
    ).toBe(true);

    expect(
      shouldOfferConductorSpinAfterVsScores({
        vsRecordedDate: "2026-06-10",
        todayTrainDate: mondayTrain,
        leadDays: 4,
        conductorMechanism: "vs_top_10",
      }),
    ).toBe(true);

    expect(
      shouldOfferConductorSpinAfterVsScores({
        vsRecordedDate: "2026-06-13",
        todayTrainDate: mondayTrain,
        leadDays: 4,
        conductorMechanism: "vs_top_10",
      }),
    ).toBe(false);
  });

  it("skips when a pending or locked conductor already exists", () => {
    expect(
      shouldOfferConductorSpinAfterVsScores({
        vsRecordedDate: fridayScores,
        todayTrainDate: saturdayTrain,
        conductorMemberId: "m1",
        conductorMechanism: "vs_top_10",
      }),
    ).toBe(false);
    expect(
      shouldOfferConductorSpinAfterVsScores({
        vsRecordedDate: fridayScores,
        todayTrainDate: saturdayTrain,
        locked: true,
        conductorMechanism: "vs_top_10",
      }),
    ).toBe(false);
  });

  it("skips automatic Top-1 (no wheel)", () => {
    expect(
      shouldOfferConductorSpinAfterVsScores({
        vsRecordedDate: fridayScores,
        todayTrainDate: saturdayTrain,
        conductorMechanism: "vs_high_score",
      }),
    ).toBe(false);
  });

  it("skips Economy Week optional VS probes", () => {
    expect(
      shouldOfferConductorSpinAfterVsScores({
        vsRecordedDate: fridayScores,
        todayTrainDate: saturdayTrain,
        conductorMechanism: "r3_lottery",
        paintTemplate: "economy_week",
      }),
    ).toBe(false);
  });
});

describe("parseConductorSpinOfferPayload", () => {
  it("accepts a trains hub href", () => {
    expect(
      parseConductorSpinOfferPayload({
        trainDate: "2026-06-13",
        href: "/trains?date=2026-06-13&autoSpin=1",
      }),
    ).toEqual({
      trainDate: "2026-06-13",
      href: "/trains?date=2026-06-13&autoSpin=1",
    });
  });

  it("rejects off-hub hrefs", () => {
    expect(
      parseConductorSpinOfferPayload({
        trainDate: "2026-06-13",
        href: "https://example.com/trains",
      }),
    ).toBeNull();
  });
});
