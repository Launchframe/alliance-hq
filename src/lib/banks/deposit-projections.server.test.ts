import { describe, expect, it } from "vitest";

import {
  parseHorizonHoursParam,
  serializeDepositProjection,
} from "@/lib/banks/deposit-projections.server";

describe("parseHorizonHoursParam", () => {
  it("defaults missing or invalid values to 72 hours", () => {
    expect(parseHorizonHoursParam(null)).toBe(72);
    expect(parseHorizonHoursParam("")).toBe(72);
    expect(parseHorizonHoursParam("999")).toBe(72);
    expect(parseHorizonHoursParam("not-a-number")).toBe(72);
  });

  it("accepts supported horizon options", () => {
    expect(parseHorizonHoursParam("24")).toBe(24);
    expect(parseHorizonHoursParam("72")).toBe(72);
    expect(parseHorizonHoursParam("120")).toBe(120);
  });
});

describe("serializeDepositProjection", () => {
  it("derives scope from bankId and filters invalid points", () => {
    const createdAt = new Date("2026-07-11T12:00:00.000Z");
    expect(
      serializeDepositProjection({
        id: "proj_1",
        bankId: "bank_a",
        name: "Before drop",
        notes: null,
        horizonHours: 72,
        stepHours: 1,
        pointsJson: [
          {
            hourStartIso: createdAt.toISOString(),
            lockedValue: 1000,
            lockedCount: 1,
            maturingValue: 0,
          },
          { hourStartIso: createdAt.toISOString(), lockedValue: "bad" },
        ],
        createdAt,
        createdByHqUserId: "user_1",
      }),
    ).toEqual({
      id: "proj_1",
      bankId: "bank_a",
      scope: "bank",
      name: "Before drop",
      notes: null,
      horizonHours: 72,
      stepHours: 1,
      points: [
        {
          hourStartIso: createdAt.toISOString(),
          lockedValue: 1000,
          lockedCount: 1,
          maturingValue: 0,
        },
      ],
      createdAt: createdAt.toISOString(),
      createdBy: "user_1",
    });
  });

  it("marks alliance-wide projections when bankId is null", () => {
    const createdAt = new Date("2026-07-11T12:00:00.000Z");
    expect(
      serializeDepositProjection({
        id: "proj_2",
        bankId: null,
        name: "Alliance rollup",
        notes: "notes",
        horizonHours: 24,
        stepHours: 1,
        pointsJson: [],
        createdAt,
        createdByHqUserId: null,
      }).scope,
    ).toBe("alliance");
  });
});
