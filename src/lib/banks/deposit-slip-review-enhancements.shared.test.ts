import { describe, expect, it } from "vitest";

import { mergeDepositSlipDisplayEnhancements } from "@/lib/banks/deposit-slip-review-enhancements.shared";

describe("mergeDepositSlipDisplayEnhancements", () => {
  it("applies interpolation and score defaults when enabled", () => {
    const rows = [
      {
        id: "a",
        score: null,
        powerLevel: "2026-07-10T10:00:00.000Z",
        frameIndex: 10,
        deleted: 0,
      },
      {
        id: "b",
        score: "",
        powerLevel: null,
        frameIndex: 20,
        deleted: 0,
      },
      {
        id: "c",
        score: "",
        powerLevel: "2026-07-10T12:00:00.000Z",
        frameIndex: 30,
        deleted: 0,
      },
    ];

    const [b] = mergeDepositSlipDisplayEnhancements(rows, {
      fillMissingDepositAmounts: true,
      fillMissingDepositTimes: true,
    }).filter((row) => row.id === "b");

    expect(b?.score).toBe("6000");
    expect(b?.scoreDefaulted).toBe(true);
    expect(b?.depositAtInterpolated).toBe(true);
    expect(Date.parse(b!.powerLevel!)).toBe(
      Date.parse("2026-07-10T11:00:00.000Z"),
    );
  });

  it("keeps timestamp empty after officer clears an interpolated value", () => {
    const rows = [
      {
        id: "a",
        score: "6000",
        powerLevel: "2026-07-10T10:00:00.000Z",
        frameIndex: 10,
        deleted: 0,
      },
      {
        id: "b",
        score: "6000",
        powerLevel: null,
        frameIndex: 20,
        deleted: 0,
        depositAtInterpolated: false,
      },
      {
        id: "c",
        score: "6000",
        powerLevel: "2026-07-10T12:00:00.000Z",
        frameIndex: 30,
        deleted: 0,
      },
    ];

    const [b] = mergeDepositSlipDisplayEnhancements(rows, {
      fillMissingDepositAmounts: true,
      fillMissingDepositTimes: true,
    }).filter((row) => row.id === "b");

    expect(b?.powerLevel).toBeNull();
    expect(b?.depositAtInterpolated).toBe(false);
  });
});
