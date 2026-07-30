import { describe, expect, it } from "vitest";

import {
  ALLIANCE_SAFE_TIME_SLOTS,
  isAllianceSafeTimeSlot,
} from "@/lib/alliance/alliance-safe-time.shared";

describe("alliance-safe-time.shared", () => {
  it("validates known slots", () => {
    for (const slot of ALLIANCE_SAFE_TIME_SLOTS) {
      expect(isAllianceSafeTimeSlot(slot)).toBe(true);
    }
    expect(isAllianceSafeTimeSlot("00")).toBe(false);
    expect(isAllianceSafeTimeSlot(null)).toBe(false);
  });
});
