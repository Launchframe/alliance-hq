import { describe, expect, it } from "vitest";

import {
  poolResetConfirmActionKey,
  poolResetConfirmBodyKey,
  poolResetTriggerLabelKey,
} from "@/lib/trains/pool-reset-copy.shared";

describe("pool reset copy helpers", () => {
  it("uses build eligibility copy when the pool is unseeded", () => {
    const summary = { total: 0, remaining: 0, exhausted: false, generation: 1 };
    expect(poolResetConfirmBodyKey(summary)).toBe("resetConfirmBodyUnseeded");
    expect(poolResetConfirmActionKey(summary)).toBe("resetConfirmActionBuild");
    expect(poolResetTriggerLabelKey(summary)).toBe("buildEligibility");
  });

  it("uses start rotation copy when the generation is exhausted", () => {
    const summary = { total: 10, remaining: 0, exhausted: true, generation: 1 };
    expect(poolResetConfirmBodyKey(summary)).toBe("resetConfirmBodyExhausted");
    expect(poolResetConfirmActionKey(summary)).toBe(
      "resetConfirmActionStartRotation",
    );
    expect(poolResetTriggerLabelKey(summary)).toBe("startNewRotation");
  });

  it("warns when starting a new rotation mid-generation", () => {
    const summary = { total: 80, remaining: 72, exhausted: false, generation: 1 };
    expect(poolResetConfirmBodyKey(summary)).toBe(
      "resetConfirmBodyMidGeneration",
    );
    expect(poolResetConfirmActionKey(summary)).toBe(
      "resetConfirmActionStartRotation",
    );
    expect(poolResetTriggerLabelKey(summary)).toBe("startNewRotation");
  });
});
