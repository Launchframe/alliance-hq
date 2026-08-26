import { describe, expect, it } from "vitest";

import {
  buildTrainDayScoreStats,
  dayNeedsScoreStats,
  scoreSourceContextForTrainDate,
  trainDayScoreStatsFromVsDataStatus,
  trainDayScoreStatsToVsDataStatus,
  vsDataStatusForTrainDaySelection,
} from "@/lib/trains/day-score-stats.shared";

describe("dayNeedsScoreStats", () => {
  it("is true for Top VS rules", () => {
    expect(
      dayNeedsScoreStats({
        conductorMechanism: "vs_high_score",
        trainDate: "2026-06-13",
      }),
    ).toBe(true);
  });

  it("is false for R4 sequence", () => {
    expect(
      dayNeedsScoreStats({
        conductorMechanism: "r4_sequence",
        trainDate: "2026-06-13",
      }),
    ).toBe(false);
  });

  it("is false on Monday for prior-day VS rules", () => {
    expect(
      dayNeedsScoreStats({
        conductorMechanism: "vs_high_score",
        trainDate: "2026-06-15",
      }),
    ).toBe(false);
  });

  it("is true on Sunday off-day when lead time inherits VS scores", () => {
    expect(
      dayNeedsScoreStats({
        conductorMechanism: "custom",
        paintTemplate: "vs_push_week_lead_time",
        trainDate: "2026-08-30",
        leadDays: 1,
        scoreDateDay: {
          conductorMechanism: "vs_top_10",
          paintTemplate: "vs_push_weekdays",
        },
      }),
    ).toBe(true);
  });
});

describe("scoreSourceContextForTrainDate", () => {
  it("maps Wednesday train to Tuesday Radar Training scores", () => {
    // 2026-06-10 is Wednesday; score date Tue 2026-06-09 = VS day 2 Base Expansion
    // Mon 2026-06-09 wait: June 8 2026 is Monday.
    // Wed 2026-06-10 → score Tue 2026-06-09 → day index 1 → Base Expansion
    expect(scoreSourceContextForTrainDate("2026-06-10")).toEqual({
      scoreDate: "2026-06-09",
      vsDayKey: "baseExpansion",
    });
  });

  it("maps Tuesday train to Monday Radar Training", () => {
    expect(scoreSourceContextForTrainDate("2026-06-09")).toEqual({
      scoreDate: "2026-06-08",
      vsDayKey: "radarTraining",
    });
  });
});

describe("buildTrainDayScoreStats / vsDataStatus round-trip", () => {
  it("keeps scoreCount and eligibleCount distinct", () => {
    const stats = buildTrainDayScoreStats({
      kind: "prior_day_vs",
      required: true,
      scoreCount: 40,
      eligibleCount: 1,
      scoreDate: "2026-06-08",
      vsDayKey: "radarTraining",
      topN: 1,
    });
    expect(stats.ready).toBe(true);
    expect(stats.scoreCount).toBe(40);
    expect(stats.eligibleCount).toBe(1);

    const status = trainDayScoreStatsToVsDataStatus(stats);
    expect(status.eligibleCount).toBe(1);
    expect(status.vsDayKey).toBe("radarTraining");

    expect(trainDayScoreStatsFromVsDataStatus(status)).toEqual(stats);
  });

  it("returns null from incomplete vsDataStatus", () => {
    expect(
      trainDayScoreStatsFromVsDataStatus({
        kind: "prior_day_vs",
        required: true,
        ready: true,
        scoreCount: 3,
        scoreDate: "2026-06-08",
      }),
    ).toBeNull();
  });
});

describe("vsDataStatusForTrainDaySelection", () => {
  it("prefers today payload when selected date is today", () => {
    expect(
      vsDataStatusForTrainDaySelection({
        selectedDate: "2026-06-10",
        today: "2026-06-10",
        todayVsDataStatus: {
          kind: "prior_day_vs",
          required: true,
          ready: false,
          scoreCount: 0,
        },
        selectedDayScoreStats: buildTrainDayScoreStats({
          kind: "prior_day_vs",
          required: false,
          scoreCount: 5,
          eligibleCount: 5,
        }),
      }),
    ).toEqual({
      kind: "prior_day_vs",
      required: true,
      ready: false,
      scoreCount: 0,
    });
  });

  it("uses week tile stats when spinning a non-today selected day", () => {
    expect(
      vsDataStatusForTrainDaySelection({
        selectedDate: "2026-06-12",
        today: "2026-06-10",
        todayVsDataStatus: {
          kind: "prior_day_vs",
          required: true,
          ready: true,
          scoreCount: 40,
        },
        selectedDayScoreStats: buildTrainDayScoreStats({
          kind: "prior_day_vs",
          required: false,
          scoreCount: 0,
          eligibleCount: 0,
          scoreDate: "2026-06-11",
        }),
      }),
    ).toMatchObject({
      kind: "prior_day_vs",
      required: false,
      scoreCount: 0,
      scoreDate: "2026-06-11",
    });
  });
});
