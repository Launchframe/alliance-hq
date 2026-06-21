import { describe, expect, it } from "vitest";

import {
  assertConductorMinimumOverrideQualification,
  buildMemberQualification,
  effectiveMinimum,
  evaluationPeriodForTrainDate,
  minimumsEnforcementEnabled,
  normalizeTrainMinimumsSettings,
} from "@/lib/trains/train-conductor-minimums.shared";

describe("train-conductor-minimums", () => {
  it("effectiveMinimum applies leeway floor", () => {
    expect(effectiveMinimum(1000, 10)).toBe(900);
    expect(effectiveMinimum(1000, 0)).toBe(1000);
    expect(effectiveMinimum(0, 50)).toBe(0);
  });

  it("weekly evaluation uses prior train week (Tue–Mon)", () => {
    expect(
      evaluationPeriodForTrainDate("2026-06-18", "weekly"),
    ).toEqual({ start: "2026-06-09", end: "2026-06-15" });
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
