import { describe, expect, it } from "vitest";

import {
  resolveWheelBlockedReseedPoolType,
  shouldShowWheelBlockedManualPick,
  wheelBlockedReseedLabelKey,
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
