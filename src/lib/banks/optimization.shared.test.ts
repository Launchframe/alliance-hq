import { describe, expect, it } from "vitest";

import {
  activeDeposits,
  buildDepositFalloffSeries,
  buildRiskHeatmap,
  maturityOutflowAtHour,
  parseSlipFingerprint,
  reconstructActualLockedSeries,
  recommendNextDrop,
  slipsForProjectionActualOverlay,
  stopTakingDepositsAt,
  summarizeProjectionVsActual,
  valueAtRiskAtHour,
} from "@/lib/banks/optimization.shared";
import type {
  BankWithSlips,
  FalloffPoint,
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
    allianceMemberId: null,
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

const MS_PER_HOUR = 60 * 60 * 1000;
const addHours = (base: Date, hours: number) =>
  new Date(base.getTime() + hours * MS_PER_HOUR);

describe("maturityOutflowAtHour", () => {
  it("sums locked deposits maturing within the hour bucket, excluding terminal slips", () => {
    const slips = [
      slip({ id: "a", amount: 1000, maturesAt: addHours(now, 2).toISOString() }),
      slip({
        id: "b",
        amount: 500,
        maturesAt: new Date(addHours(now, 2).getTime() + 30 * 60 * 1000).toISOString(),
      }),
      slip({ id: "c", amount: 2000, maturesAt: addHours(now, 5).toISOString() }),
      slip({
        id: "d",
        amount: 9000,
        status: "matured",
        outcomeAt: addHours(now, 2).toISOString(),
        maturesAt: addHours(now, 2).toISOString(),
      }),
    ];

    expect(maturityOutflowAtHour(slips, addHours(now, 2), now)).toBe(1500);
    expect(maturityOutflowAtHour(slips, addHours(now, 5), now)).toBe(2000);
    expect(maturityOutflowAtHour(slips, addHours(now, 3), now)).toBe(0);
  });
});

describe("buildDepositFalloffSeries", () => {
  it("builds hourly locked-value and maturing-outflow points over the horizon", () => {
    const slips = [
      slip({ id: "s1", amount: 1000, maturesAt: addHours(now, 1).toISOString() }),
      slip({ id: "s2", amount: 2000, maturesAt: addHours(now, 3).toISOString() }),
    ];

    const points = buildDepositFalloffSeries(slips, { hours: 4, now, stepHours: 1 });

    expect(points).toHaveLength(4);
    expect(points.map((point) => point.hourStartIso)).toEqual([
      now.toISOString(),
      addHours(now, 1).toISOString(),
      addHours(now, 2).toISOString(),
      addHours(now, 3).toISOString(),
    ]);
    expect(points.map((point) => point.lockedValue)).toEqual([3000, 2000, 2000, 0]);
    expect(points.map((point) => point.lockedCount)).toEqual([2, 1, 1, 0]);
    expect(points.map((point) => point.maturingValue)).toEqual([0, 1000, 0, 2000]);
  });

  it("defaults to a 72 hour horizon with a 1 hour step", () => {
    const points = buildDepositFalloffSeries([slip({})], { now });
    expect(points).toHaveLength(72);
  });
});

describe("reconstructActualLockedSeries", () => {
  it("derives locked state purely from deposit/mature/outcome timestamps", () => {
    const slips = [
      slip({
        id: "x",
        amount: 1000,
        depositAt: addHours(now, -2).toISOString(),
        maturesAt: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
        outcomeAt: null,
      }),
      slip({
        id: "y",
        amount: 2000,
        depositAt: addHours(now, -3).toISOString(),
        maturesAt: addHours(now, 5).toISOString(),
        outcomeAt: now.toISOString(),
      }),
    ];

    const points = reconstructActualLockedSeries(
      slips,
      addHours(now, -1),
      addHours(now, 1),
      1,
    );

    expect(points.map((point) => point.hourStartIso)).toEqual([
      addHours(now, -1).toISOString(),
      now.toISOString(),
      addHours(now, 1).toISOString(),
    ]);
    expect(points.map((point) => point.lockedValue)).toEqual([3000, 1000, 0]);
    expect(points.map((point) => point.lockedCount)).toEqual([2, 1, 0]);
    expect(points.map((point) => point.maturingValue)).toEqual([0, 1000, 0]);
  });
});

describe("parseSlipFingerprint", () => {
  it("reads valid fingerprint entries and skips malformed rows", () => {
    expect(
      parseSlipFingerprint({
        slipFingerprint: [
          {
            id: "a",
            amount: 1000,
            status: "locked",
            depositAt: "2026-07-09T16:00:00.000Z",
            maturesAt: "2026-07-10T16:00:00.000Z",
            outcomeAt: null,
          },
          { id: "bad", amount: "nope" },
        ],
      }),
    ).toEqual([
      {
        id: "a",
        amount: 1000,
        status: "locked",
        depositAt: "2026-07-09T16:00:00.000Z",
        maturesAt: "2026-07-10T16:00:00.000Z",
        outcomeAt: null,
      },
    ]);
    expect(parseSlipFingerprint(null)).toEqual([]);
    expect(parseSlipFingerprint({})).toEqual([]);
  });
});

describe("slipsForProjectionActualOverlay", () => {
  it("freezes fingerprinted amount/deposit/maturity while overlaying live outcomes", () => {
    const fingerprint = [
      {
        id: "a",
        amount: 1000,
        status: "locked" as const,
        depositAt: "2026-07-09T16:00:00.000Z",
        maturesAt: "2026-07-12T16:00:00.000Z",
        outcomeAt: null,
      },
    ];
    const current = [
      slip({
        id: "a",
        amount: 9999,
        depositAt: "2026-07-01T00:00:00.000Z",
        maturesAt: "2026-07-20T00:00:00.000Z",
        status: "looted",
        outcomeAt: "2026-07-11T12:00:00.000Z",
        bankId: "bank-1",
        termDays: 3,
      }),
      slip({
        id: "newcomer",
        amount: 500,
        depositAt: "2026-07-11T00:00:00.000Z",
        maturesAt: "2026-07-14T00:00:00.000Z",
      }),
    ];

    const overlay = slipsForProjectionActualOverlay(fingerprint, current);
    expect(overlay).toHaveLength(2);
    expect(overlay[0]).toMatchObject({
      id: "a",
      amount: 1000,
      depositAt: "2026-07-09T16:00:00.000Z",
      maturesAt: "2026-07-12T16:00:00.000Z",
      status: "looted",
      outcomeAt: "2026-07-11T12:00:00.000Z",
      bankId: "bank-1",
      termDays: 3,
    });
    expect(overlay[1]?.id).toBe("newcomer");
  });

  it("falls back to the live ledger when fingerprint is empty", () => {
    const current = [slip({ id: "live" })];
    expect(slipsForProjectionActualOverlay([], current)).toEqual(current);
  });
});

describe("summarizeProjectionVsActual", () => {
  it("computes final delta, worst-case errors in both directions, and unexpected inflow", () => {
    const point = (hoursFromNow: number, lockedValue: number): FalloffPoint => ({
      hourStartIso: addHours(now, hoursFromNow).toISOString(),
      lockedValue,
      lockedCount: 0,
      maturingValue: 0,
    });

    const projected = [point(0, 3000), point(1, 2000), point(2, 1000), point(3, 0)];
    const actual = [point(0, 3000), point(1, 2500), point(2, 500), point(3, 800)];

    expect(summarizeProjectionVsActual(projected, actual)).toEqual({
      finalDelta: 800,
      maxPositiveError: 800,
      unexpectedInflow: 300,
      earlyLootValue: 500,
    });
  });

  it("returns zeros when there is nothing to compare", () => {
    expect(summarizeProjectionVsActual([], [])).toEqual({
      finalDelta: 0,
      maxPositiveError: 0,
      unexpectedInflow: 0,
      earlyLootValue: 0,
    });
  });
});
