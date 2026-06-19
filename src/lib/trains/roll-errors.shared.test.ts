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

  it("returns null for unrelated errors", () => {
    expect(parseTrainRollError({ error: "Conductor is already locked." })).toBeNull();
  });

  it("flags wheel-blocked details", () => {
    expect(
      isWheelBlockedError(parseTrainRollError({ rollError: { code: "POOL_EMPTY", poolType: "r3" } })),
    ).toBe(true);
    expect(isWheelBlockedError(null)).toBe(false);
  });
});
