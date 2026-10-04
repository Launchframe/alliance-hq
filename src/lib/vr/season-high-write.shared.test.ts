import { describe, expect, it } from "vitest";

import { shouldApplySeasonVrWrite } from "@/lib/vr/season-high-write.shared";

describe("shouldApplySeasonVrWrite", () => {
  it("rejects a stale lower write after a concurrent higher season high (bug repro)", () => {
    // Both writers read previous=5000. Writer A commits 9000 first.
    // Writer B then tries 8500 with a stale expectedPreviousBaseVr=5000.
    // Blind onConflictDoUpdate would store 8500 and lose the true high.
    expect(
      shouldApplySeasonVrWrite({
        incomingBaseVr: 8500,
        storedHighestBaseVr: 9000,
        expectedPreviousBaseVr: 5000,
      }),
    ).toBe(false);
  });

  it("accepts a higher (or equal) incoming value", () => {
    expect(
      shouldApplySeasonVrWrite({
        incomingBaseVr: 9000,
        storedHighestBaseVr: 8500,
        expectedPreviousBaseVr: 5000,
      }),
    ).toBe(true);
    expect(
      shouldApplySeasonVrWrite({
        incomingBaseVr: 9000,
        storedHighestBaseVr: 9000,
        expectedPreviousBaseVr: 9000,
      }),
    ).toBe(true);
  });

  it("accepts an intentional downgrade when the row still matches the caller's read", () => {
    expect(
      shouldApplySeasonVrWrite({
        incomingBaseVr: 8500,
        storedHighestBaseVr: 9000,
        expectedPreviousBaseVr: 9000,
      }),
    ).toBe(true);
  });

  it("rejects a downgrade when a concurrent writer already moved the high", () => {
    expect(
      shouldApplySeasonVrWrite({
        incomingBaseVr: 8500,
        storedHighestBaseVr: 9200,
        expectedPreviousBaseVr: 9000,
      }),
    ).toBe(false);
  });

  it("keeps the stored high when previous was unknown and incoming is lower", () => {
    expect(
      shouldApplySeasonVrWrite({
        incomingBaseVr: 8500,
        storedHighestBaseVr: 9000,
        expectedPreviousBaseVr: null,
      }),
    ).toBe(false);
  });
});
