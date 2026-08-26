import { describe, expect, it } from "vitest";

import {
  canSpinConductorWithLeadScope,
  effectiveVsScopeMechanismForTrainDate,
  resolveVsTopBoardForTrainDate,
} from "@/lib/trains/vs-score-scope.shared";

describe("resolveVsTopBoardForTrainDate", () => {
  it("uses score day's VS scope when lead time shifts the source date", () => {
    // Fri 2026-08-28 (vs_high_score / top 1) with lead 1 → Wed 2026-08-26 (vs_top_10)
    expect(
      resolveVsTopBoardForTrainDate({
        trainDate: "2026-08-28",
        trainDay: { conductorMechanism: "vs_high_score" },
        leadDays: 1,
        scoreDateDay: { conductorMechanism: "vs_top_10" },
      }),
    ).toEqual({
      kind: "vs",
      topN: 10,
      mechanism: "vs_top_10",
    });
  });

  it("keeps train day scope when lead time is zero", () => {
    expect(
      resolveVsTopBoardForTrainDate({
        trainDate: "2026-08-28",
        trainDay: { conductorMechanism: "vs_high_score" },
        leadDays: 0,
        scoreDateDay: { conductorMechanism: "vs_top_10" },
      }),
    ).toEqual({
      kind: "vs",
      topN: 1,
      mechanism: "vs_high_score",
    });
  });
});

describe("effectiveVsScopeMechanismForTrainDate", () => {
  it("labels Friday with Wednesday's VS T10 scope under lead time 1", () => {
    expect(
      effectiveVsScopeMechanismForTrainDate({
        trainDate: "2026-08-28",
        trainDay: { conductorMechanism: "vs_high_score" },
        leadDays: 1,
        scoreDateDay: { conductorMechanism: "vs_top_10" },
        fallbackMechanism: "vs_high_score",
      }),
    ).toBe("vs_top_10");
  });

  it("labels Sunday off-day with Friday VS scope under lead time 1", () => {
    expect(
      effectiveVsScopeMechanismForTrainDate({
        trainDate: "2026-08-30",
        trainDay: { conductorMechanism: "custom" },
        leadDays: 1,
        scoreDateDay: {
          conductorMechanism: "vs_top_10",
          paintTemplate: "vs_push_weekdays",
        },
        fallbackMechanism: "custom",
      }),
    ).toBe("vs_top_10");
  });
});

describe("canSpinConductorWithLeadScope", () => {
  it("allows wheel spin when lead time upgrades auto top-1 to top-10", () => {
    expect(
      canSpinConductorWithLeadScope({
        conductorMechanism: "vs_high_score",
        locked: false,
        paintTemplate: "vs_push_weekdays",
        trainDate: "2026-08-28",
        leadDays: 1,
        scoreDateDay: { conductorMechanism: "vs_top_10" },
      }),
    ).toBe(true);
  });

  it("blocks auto top-1 without lead time", () => {
    expect(
      canSpinConductorWithLeadScope({
        conductorMechanism: "vs_high_score",
        locked: false,
        paintTemplate: "vs_push_weekdays",
        trainDate: "2026-08-28",
        leadDays: 0,
        scoreDateDay: { conductorMechanism: "vs_top_10" },
      }),
    ).toBe(false);
  });
});
