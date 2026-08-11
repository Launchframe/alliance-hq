import { describe, expect, it } from "vitest";

import {
  isWheelBlockedError,
  parseTrainRollError,
} from "@/lib/trains/roll-errors.shared";

describe("parseTrainRollError", () => {
  it("reads structured rollError from the API", () => {
    expect(
      parseTrainRollError({
        error: "No eligible members for r3 pool.",
        rollError: { code: "POOL_EMPTY", poolType: "r3" },
      }),
    ).toEqual({ code: "POOL_EMPTY", poolType: "r3" });
  });

  it("parses legacy empty pool messages", () => {
    expect(
      parseTrainRollError({
        error: "No eligible members for r3 pool.",
      }),
    ).toEqual({ code: "POOL_EMPTY", poolType: "r3" });
  });

  it("parses pool exhausted messages", () => {
    expect(
      parseTrainRollError({
        error: "Pool exhausted. Re-seed the pool to start a new generation.",
      }),
    ).toEqual({ code: "POOL_EXHAUSTED" });
  });

  it("parses VR wheel candidate messages", () => {
    expect(
      parseTrainRollError({
        error: "No VR standings found for the wheel.",
      }),
    ).toEqual({ code: "NO_WHEEL_CANDIDATES", candidateKind: "vr" });
    expect(
      parseTrainRollError({
        error:
          "Only 2 of 5 active-roster VR standings available for Top 5.",
      }),
    ).toEqual({ code: "NO_WHEEL_CANDIDATES", candidateKind: "vr" });
  });

  it("returns null for unrelated errors", () => {
    expect(parseTrainRollError({ error: "Conductor is already locked." })).toBeNull();
  });

  it("flags wheel-blocked details", () => {
    expect(
      isWheelBlockedError(parseTrainRollError({ rollError: { code: "POOL_EMPTY", poolType: "r3" } })),
    ).toBe(true);
    expect(isWheelBlockedError(null)).toBe(false);
    expect(
      parseTrainRollError({
        rollError: { code: "POOL_UNAVAILABLE", poolType: "r3" },
      }),
    ).toEqual({ code: "POOL_UNAVAILABLE", poolType: "r3" });
  });

  it("parses POOL_BUSY and does not treat it as wheel-blocked", () => {
    const details = parseTrainRollError({
      error:
        "Another officer is spinning this pool right now. Try again in a moment.",
      rollError: { code: "POOL_BUSY", poolType: "r3" },
    });
    expect(details).toEqual({ code: "POOL_BUSY", poolType: "r3" });
    expect(isWheelBlockedError(details)).toBe(false);
  });
});
