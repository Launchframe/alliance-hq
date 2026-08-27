import { describe, expect, it } from "vitest";

import {
  resolveWheelBlockedReseedPoolType,
  shouldShowWheelBlockedLeadTimeLink,
  shouldShowWheelBlockedManualPick,
  wheelBlockedReseedLabelKey,
  wheelBlockedVsBodyKey,
} from "@/lib/trains/wheel-blocked-cta.shared";

describe("resolveWheelBlockedReseedPoolType", () => {
  it("offers reseed for exhausted and empty pools", () => {
    expect(
      resolveWheelBlockedReseedPoolType({
        code: "POOL_EXHAUSTED",
        poolType: "r3",
      }),
    ).toBe("r3");
    expect(
      resolveWheelBlockedReseedPoolType({
        code: "POOL_EMPTY",
        poolType: "r4_plus",
      }),
    ).toBe("r4_plus");
  });

  it("does not offer reseed when members remain but none qualify", () => {
    expect(
      resolveWheelBlockedReseedPoolType({
        code: "POOL_UNAVAILABLE",
        poolType: "r3",
      }),
    ).toBeNull();
  });

  it("never offers reseed for Price Is Freight with-replacement paints", () => {
    expect(
      resolveWheelBlockedReseedPoolType(
        { code: "POOL_EMPTY", poolType: "r3" },
        null,
        { paintTemplate: "price_is_right" },
      ),
    ).toBeNull();
    expect(
      resolveWheelBlockedReseedPoolType(
        { code: "POOL_EXHAUSTED", poolType: "r3" },
        null,
        { paintTemplate: "takedown_week" },
      ),
    ).toBeNull();
  });

  it("falls back to the conductor pool type for legacy payloads", () => {
    expect(
      resolveWheelBlockedReseedPoolType(
        { code: "POOL_EXHAUSTED" },
        "heavy_hitter",
      ),
    ).toBe("heavy_hitter");
  });
});

describe("shouldShowWheelBlockedManualPick", () => {
  it("includes POOL_UNAVAILABLE so officers can pick without starting a new generation", () => {
    expect(
      shouldShowWheelBlockedManualPick({ code: "POOL_UNAVAILABLE" }),
    ).toBe(true);
  });

  it("includes day-spin exhaustion so officers can pick manually", () => {
    expect(
      shouldShowWheelBlockedManualPick({
        code: "NO_WHEEL_CANDIDATES",
        candidateKind: "vs",
        spinBlockReason: "day_spin_exhausted",
      }),
    ).toBe(true);
  });
});

describe("wheelBlockedReseedLabelKey", () => {
  it("uses build copy for empty pools and rotation copy when exhausted", () => {
    expect(
      wheelBlockedReseedLabelKey({ code: "POOL_EMPTY", poolType: "r3" }),
    ).toBe("wheelBlocked.buildEligibilityAndRespin");
    expect(
      wheelBlockedReseedLabelKey({ code: "POOL_EXHAUSTED", poolType: "r3" }),
    ).toBe("wheelBlocked.startNewRotationAndRespin");
  });
});

describe("shouldShowWheelBlockedLeadTimeLink", () => {
  it("shows only for missing VS with leadDays > 0", () => {
    expect(
      shouldShowWheelBlockedLeadTimeLink({
        code: "NO_WHEEL_CANDIDATES",
        candidateKind: "vs",
        leadDays: 1,
        scoreDate: "2026-08-10",
      }),
    ).toBe(true);
    expect(
      shouldShowWheelBlockedLeadTimeLink({
        code: "NO_WHEEL_CANDIDATES",
        candidateKind: "vs",
        leadDays: 0,
        scoreDate: "2026-08-11",
      }),
    ).toBe(false);
    expect(
      shouldShowWheelBlockedLeadTimeLink({
        code: "POOL_EMPTY",
        poolType: "r3",
        leadDays: 2,
      }),
    ).toBe(false);
    expect(
      shouldShowWheelBlockedLeadTimeLink({
        code: "NO_WHEEL_CANDIDATES",
        candidateKind: "vs",
        leadDays: 1,
        spinBlockReason: "day_spin_exhausted",
      }),
    ).toBe(false);
  });
});

describe("wheelBlockedVsBodyKey", () => {
  it("picks lead-time copy when scoreDate and leadDays are set", () => {
    expect(
      wheelBlockedVsBodyKey({
        code: "NO_WHEEL_CANDIDATES",
        candidateKind: "vs",
        scoreDate: "2026-08-10",
        leadDays: 1,
      }),
    ).toBe("wheelBlocked.requiresVsScoresWithLeadTime");
    expect(
      wheelBlockedVsBodyKey({
        code: "NO_WHEEL_CANDIDATES",
        candidateKind: "vs",
        scoreDate: "2026-08-11",
        leadDays: 0,
      }),
    ).toBe("wheelBlocked.requiresVsScores");
    expect(
      wheelBlockedVsBodyKey({
        code: "NO_WHEEL_CANDIDATES",
        candidateKind: "vs",
      }),
    ).toBe("wheelBlocked.noVsScores");
  });
});
