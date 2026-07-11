import { describe, expect, it } from "vitest";

import {
  activeDeposits,
  buildRiskHeatmap,
  recommendNextDrop,
  stopTakingDepositsAt,
  valueAtRiskAtHour,
} from "@/lib/banks/optimization.shared";
import type {
  BankWithSlips,
  SerializedDepositSlip,
} from "@/lib/banks/types.shared";

const now = new Date("2026-07-10T16:00:00.000-02:00");

function slip(
  overrides: Partial<SerializedDepositSlip>,
): SerializedDepositSlip {
  return {
    id: "slip-1",
    bankId: "bank-1",
    depositAt: "2026-07-09T16:00:00.000-02:00",
    termDays: 1,
    maturesAt: "2026-07-10T16:00:00.000-02:00",
    status: "locked",
    outcomeAt: null,
    amount: 6000,
    depositAllianceTag: "Roar",
    depositAllianceId: null,
    commanderName: "snapz a saurus",
    commanderId: null,
    createdAt: "2026-07-09T16:00:00.000Z",
    updatedAt: "2026-07-09T16:00:00.000Z",
    ...overrides,
  };
}

function bank(
  overrides: Partial<BankWithSlips> & { id: string; level: number },
): BankWithSlips {
  return {
    gameServerNumber: 1211,
    coordX: 699,
    coordY: 499,
    capturedAt: null,
    dropByAt: null,
    depositPolicy: "warzone",
    priorCaptureCount: 1,
    currentDepositCount: null,
    currentDepositValue: null,
    notes: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    depositSlips: [],
    ...overrides,
  };
}

describe("activeDeposits", () => {
  it("excludes matured, looted, and already-mature locked slips", () => {
    const slips = [
      slip({ id: "a", maturesAt: "2026-07-11T16:00:00.000-02:00" }),
      slip({
        id: "b",
        status: "matured",
        maturesAt: "2026-07-11T16:00:00.000-02:00",
      }),
      slip({
        id: "c",
        status: "looted",
        maturesAt: "2026-07-11T16:00:00.000-02:00",
      }),
      slip({ id: "d", maturesAt: "2026-07-10T15:00:00.000-02:00" }),
    ];
    expect(activeDeposits(slips, now).map((row) => row.id)).toEqual(["a"]);
  });
});

describe("recommendNextDrop", () => {
  it("prefers the lowest-level bank with minimal value at risk", () => {
    const banks = [
      bank({
        id: "high",
        level: 3,
        depositSlips: [
          slip({
            id: "h1",
            bankId: "high",
            amount: 1000,
            maturesAt: "2026-07-12T16:00:00.000-02:00",
          }),
        ],
      }),
      bank({
        id: "low-risky",
        level: 2,
        depositSlips: [
          slip({
            id: "l1",
            bankId: "low-risky",
            amount: 6000,
            maturesAt: "2026-07-12T16:00:00.000-02:00",
          }),
        ],
      }),
      bank({
        id: "low-safe",
        level: 2,
        depositSlips: [
          slip({
            id: "l2",
            bankId: "low-safe",
            amount: 1000,
            maturesAt: "2026-07-12T16:00:00.000-02:00",
          }),
        ],
      }),
    ];

    const recommendation = recommendNextDrop(banks, {
      nextCaptureLevel: 4,
      now,
    });
    expect(recommendation?.bankId).toBe("low-safe");
    expect(recommendation?.valueAtRisk).toBe(1000);
    expect(recommendation?.reasons[0]).toContain("Lv.2");
  });

  it("returns null when no banks are held", () => {
    expect(recommendNextDrop([], { now })).toBeNull();
  });
});

describe("stopTakingDepositsAt", () => {
  it("subtracts each term from the target capture time", () => {
    const target = new Date("2026-07-15T12:00:00.000Z");
    const stops = stopTakingDepositsAt(target);
    expect(stops).toEqual([
      { termDays: 1, stopAtIso: "2026-07-14T12:00:00.000Z" },
      { termDays: 3, stopAtIso: "2026-07-12T12:00:00.000Z" },
      { termDays: 5, stopAtIso: "2026-07-10T12:00:00.000Z" },
    ]);
  });
});

describe("buildRiskHeatmap", () => {
  it("marks later hours greener as deposits mature", () => {
    const target = bank({
      id: "bank-1",
      level: 2,
      depositSlips: [
        slip({
          id: "soon",
          maturesAt: "2026-07-10T18:00:00.000-02:00",
          amount: 6000,
        }),
        slip({
          id: "later",
          maturesAt: "2026-07-11T16:00:00.000-02:00",
          amount: 6000,
        }),
      ],
    });

    const heatmap = buildRiskHeatmap(target, { hours: 24, now });
    expect(heatmap).toHaveLength(24);
    expect(heatmap[0]!.countAtRisk).toBe(2);
    expect(heatmap[0]!.intensity).toBe(1);
    const afterFirst = heatmap.find(
      (cell) =>
        new Date(cell.hourStartIso).getTime() >=
        new Date("2026-07-10T18:00:00.000-02:00").getTime(),
    );
    expect(afterFirst?.countAtRisk).toBe(1);
    expect(afterFirst!.intensity).toBeLessThan(1);
    expect(valueAtRiskAtHour(target.depositSlips, now, now)).toBe(12000);
  });
});
