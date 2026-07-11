import { describe, expect, it } from "vitest";

import { isMemberEligibleForPool } from "@/lib/trains/rank-history";

describe("isMemberEligibleForPool", () => {
  it("accepts R4 and R5 for r4_plus", () => {
    expect(isMemberEligibleForPool("r4_plus", 4)).toBe(true);
    expect(isMemberEligibleForPool("r4_plus", 5)).toBe(true);
    expect(isMemberEligibleForPool("r4_plus", 3)).toBe(false);
    expect(isMemberEligibleForPool("r4_plus", null)).toBe(false);
  });

  it("accepts only R3 for r3 pool", () => {
    expect(isMemberEligibleForPool("r3", 3)).toBe(true);
    expect(isMemberEligibleForPool("r3", 4)).toBe(false);
  });

  it("accepts any rank for heavy_hitter (membership-list pool)", () => {
    expect(isMemberEligibleForPool("heavy_hitter", 3)).toBe(true);
    expect(isMemberEligibleForPool("heavy_hitter", 5)).toBe(true);
    expect(isMemberEligibleForPool("heavy_hitter", null)).toBe(true);
  });
});
