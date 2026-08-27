import { describe, expect, it } from "vitest";

import {
  assertConductorMinimumOverrideQualification,
  buildConductorMinimumsDataStatus,
  buildMemberQualification,
  effectiveMinimum,
  evaluationPeriodForTrainDate,
  evaluationPeriodHasUploadedVsScores,
  minimumsEnforcementEnabled,
  minimumsSettingsForHqLocalEval,
  normalizeTrainMinimumsSettings,
  poolTypeRespectsConductorMinimums,
  conductorQualificationGateApplies,
  formatTrainPointCount,
} from "@/lib/trains/train-conductor-minimums.shared";

describe("train-conductor-minimums", () => {
  it("effectiveMinimum applies leeway floor", () => {
    expect(effectiveMinimum(1000, 10)).toBe(900);
    expect(effectiveMinimum(1000, 0)).toBe(1000);
    expect(effectiveMinimum(0, 50)).toBe(0);
  });

  it("poolTypeRespectsConductorMinimums applies to r3 and heavy hitter only", () => {
    expect(poolTypeRespectsConductorMinimums("r3")).toBe(true);
    expect(poolTypeRespectsConductorMinimums("heavy_hitter")).toBe(true);
    expect(poolTypeRespectsConductorMinimums("r4_plus")).toBe(false);
    expect(poolTypeRespectsConductorMinimums("all_members")).toBe(false);
  });

  it("conductorQualificationGateApplies for R3/heavy-hitter when minimums enabled", () => {
    expect(
      conductorQualificationGateApplies({
        poolType: "r4_plus",
        minimumsEnabled: true,
      }),
    ).toBe(false);
    expect(
      conductorQualificationGateApplies({
        poolType: "r3",
        minimumsEnabled: false,
      }),
    ).toBe(false);
    expect(
      conductorQualificationGateApplies({
        poolType: "r3",
        minimumsEnabled: true,
      }),
    ).toBe(true);
    expect(
      conductorQualificationGateApplies({
        poolType: "heavy_hitter",
        minimumsEnabled: true,
      }),
    ).toBe(true);
    // VS minimums apply to r3/heavy_hitter pools when enabled (score source is
    // Ashed VS for the evaluation window, not season VR).
    expect(
      conductorQualificationGateApplies({
        poolType: "r3",
        minimumsEnabled: true,
      }),
    ).toBe(true);
  });

  it("skips conductor minimums off Price Is Freight paints", () => {
    expect(
      conductorQualificationGateApplies({
        poolType: "r3",
        minimumsEnabled: true,
        paintTemplate: "economy_week",
      }),
    ).toBe(false);
    expect(
      conductorQualificationGateApplies({
        poolType: "r3",
        minimumsEnabled: true,
        paintTemplate: "price_is_right_weekdays",
      }),
    ).toBe(true);
    expect(
      conductorQualificationGateApplies({
        poolType: "heavy_hitter",
        minimumsEnabled: true,
        paintTemplate: "takedown_week",
      }),
    ).toBe(true);
  });

  it("formatTrainPointCount uses locale grouping", () => {
    expect(formatTrainPointCount(6_480_000, "en-US")).toBe("6,480,000");
    expect(formatTrainPointCount(6_480_000, "pt-BR")).toBe("6.480.000");
  });

  it("weekly evaluation uses prior train week (Tue–Mon)", () => {
    expect(
      evaluationPeriodForTrainDate("2026-06-18", "weekly"),
    ).toEqual({ start: "2026-06-09", end: "2026-06-15" });
  });

  it("aligns daily PIF evaluation with VS score reference date under lead time", () => {
    expect(
      evaluationPeriodForTrainDate("2026-06-10", "daily", undefined, {
        leadDays: 1,
        paintTemplate: "price_is_right",
      }),
    ).toEqual({ start: "2026-06-08", end: "2026-06-08" });
    expect(
      evaluationPeriodForTrainDate("2026-06-10", "daily", undefined, {
        leadDays: 0,
        paintTemplate: "price_is_right",
      }),
    ).toEqual({ start: "2026-06-09", end: "2026-06-09" });
  });

  it("daily evaluation uses prior calendar day", () => {
    expect(
      evaluationPeriodForTrainDate("2026-06-18", "daily"),
    ).toEqual({ start: "2026-06-17", end: "2026-06-17" });
  });

  it("buildMemberQualification respects leeway on both criteria", () => {
    const settings = normalizeTrainMinimumsSettings({
      minVsPoints: 1000,
      minDonationPoints: 500,
      leewayPct: 10,
      window: "weekly",
    });
    const ok = buildMemberQualification({
      vsScore: 900,
      donationScore: 450,
      settings,
      periodStart: "2026-06-08",
      periodEnd: "2026-06-14",
    });
    expect(ok.qualified).toBe(true);
    expect(ok.vs.shortfall).toBe(0);
    expect(ok.donation.shortfall).toBe(0);

    const fail = buildMemberQualification({
      vsScore: 850,
      donationScore: 450,
      settings,
      periodStart: "2026-06-08",
      periodEnd: "2026-06-14",
    });
    expect(fail.qualified).toBe(false);
    expect(fail.vs.shortfall).toBe(50);
  });

  it("minimumsEnforcementEnabled when either threshold is set", () => {
    expect(
      minimumsEnforcementEnabled(
        normalizeTrainMinimumsSettings({ minVsPoints: 100 }),
      ),
    ).toBe(true);
    expect(
      minimumsEnforcementEnabled(
        normalizeTrainMinimumsSettings({ minDonationPoints: 50 }),
      ),
    ).toBe(true);
    expect(
      minimumsEnforcementEnabled(normalizeTrainMinimumsSettings({})),
    ).toBe(false);
  });

  it("evaluationPeriodHasUploadedVsScores is false for empty maps", () => {
    expect(evaluationPeriodHasUploadedVsScores(new Map())).toBe(false);
    expect(
      evaluationPeriodHasUploadedVsScores(new Map([["m1", 0]])),
    ).toBe(true);
  });

  it("buildConductorMinimumsDataStatus flags missing VS for PIF daily minimums", () => {
    const settings = normalizeTrainMinimumsSettings({
      minVsPoints: 7_200_000,
      window: "daily",
    });
    const status = buildConductorMinimumsDataStatus({
      settings,
      trainDate: "2026-08-28",
      paintTemplate: "price_is_right",
      leadDays: 1,
      vsScoreCount: 0,
    });
    expect(status?.missingVsScores).toBe(true);
    expect(status?.uploadScoreDate).toBe(
      evaluationPeriodForTrainDate("2026-08-28", "daily", undefined, {
        leadDays: 1,
        paintTemplate: "price_is_right",
      }).start,
    );
  });

  it("minimumsSettingsForHqLocalEval clears donation threshold without HQ ledger", () => {
    const withDonation = normalizeTrainMinimumsSettings({
      minVsPoints: 1000,
      minDonationPoints: 500,
      leewayPct: 0,
      window: "weekly",
    });
    expect(minimumsSettingsForHqLocalEval(withDonation)).toEqual({
      minVsPoints: 1000,
      minDonationPoints: null,
      leewayPct: 0,
      window: "weekly",
    });

    const vsOnly = normalizeTrainMinimumsSettings({ minVsPoints: 1000 });
    expect(minimumsSettingsForHqLocalEval(vsOnly)).toBe(vsOnly);
  });

  it("assertConductorMinimumOverrideQualification rejects missing or qualified", () => {
    const settings = normalizeTrainMinimumsSettings({
      minVsPoints: 1000,
      leewayPct: 0,
      window: "weekly",
    });
    const disqualified = buildMemberQualification({
      vsScore: 0,
      donationScore: 0,
      settings,
      periodStart: "2026-06-08",
      periodEnd: "2026-06-14",
    });
    expect(disqualified.qualified).toBe(false);
    expect(assertConductorMinimumOverrideQualification(disqualified)).toBe(
      disqualified,
    );

    const qualified = buildMemberQualification({
      vsScore: 2000,
      donationScore: 0,
      settings,
      periodStart: "2026-06-08",
      periodEnd: "2026-06-14",
    });
    expect(() =>
      assertConductorMinimumOverrideQualification(qualified),
    ).toThrow(/override is not allowed/);
    expect(() => assertConductorMinimumOverrideQualification(null)).toThrow(
      /without score data/,
    );
  });
});
