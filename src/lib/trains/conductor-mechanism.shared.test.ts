import { describe, expect, it } from "vitest";

import { hasValidConductorPickForDay } from "@/lib/trains/conductor-mechanism.shared";

describe("hasValidConductorPickForDay", () => {
  it("treats a pre-rules record as valid for today's rule", () => {
    expect(
      hasValidConductorPickForDay({
        conductorMemberId: "m1",
        recordRule: null,
        dayRule: { kind: "price_is_freight", board: "weekday" },
        recordHasRule: false,
      }),
    ).toBe(true);
  });

  it("does not count a leftover R4 snapshot on an Eligible VS scores day", () => {
    expect(
      hasValidConductorPickForDay({
        conductorMemberId: "m1",
        recordRule: { kind: "rank_pool", pool: "r4_plus", draw: "wheel" },
        dayRule: { kind: "price_is_freight", board: "weekday" },
        recordHasRule: true,
      }),
    ).toBe(false);
  });

  it("counts a pick snapshotted under today's Eligible VS scores rule", () => {
    expect(
      hasValidConductorPickForDay({
        conductorMemberId: "m1",
        recordRule: { kind: "price_is_freight", board: "weekday" },
        dayRule: { kind: "price_is_freight", board: "weekday" },
        recordHasRule: true,
      }),
    ).toBe(true);
  });

  it("counts a free-choice day whose record was restamped to null", () => {
    expect(
      hasValidConductorPickForDay({
        conductorMemberId: "m1",
        recordRule: null,
        dayRule: null,
        recordHasRule: false,
      }),
    ).toBe(true);
  });
});
