import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/lib/db";
import { loadBanksWithSlips } from "@/lib/banks/repository.server";
import {
  createDepositProjection,
  parseHorizonHoursParam,
  serializeDepositProjection,
} from "@/lib/banks/deposit-projections.server";
import { buildDepositFalloffSeries } from "@/lib/banks/optimization.shared";
import type { BankWithSlips } from "@/lib/banks/types.shared";

vi.mock("@/lib/banks/repository.server", () => ({
  loadBanksWithSlips: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: vi.fn(),
  };
});

const now = new Date("2026-07-11T12:00:00.000Z");

function makeBank(id: string, amount: number): BankWithSlips {
  return {
    id,
    gameServerNumber: 1,
    coordX: 10,
    coordY: 20,
    level: 5,
    capturedAt: null,
    dropByAt: null,
    depositPolicy: "alliance",
    priorCaptureCount: 0,
    currentDepositCount: 1,
    currentDepositValue: amount,
    notes: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    depositSlips: [
      {
        id: `slip_${id}`,
        bankId: id,
        depositAt: now.toISOString(),
        termDays: 3,
        maturesAt: new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString(),
        status: "locked",
        outcomeAt: null,
        amount,
        depositAllianceTag: "TAG",
        depositAllianceId: null,
        commanderName: "Cmdr",
        commanderId: null,
        allianceMemberId: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    ],
  };
}

describe("createDepositProjection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects invalid or missing scope", async () => {
    vi.mocked(loadBanksWithSlips).mockResolvedValue([makeBank("bank_a", 1000)]);

    await expect(
      createDepositProjection("alliance_1", "user_1", {
        bankId: "bank_a",
        scope: "" as never,
        name: "Test",
        horizonHours: 72,
      }),
    ).rejects.toThrow("Invalid scope.");

    await expect(
      createDepositProjection("alliance_1", "user_1", {
        bankId: null,
        scope: "bank",
        name: "Test",
        horizonHours: 72,
      }),
    ).rejects.toThrow("bankId is required for bank-scoped projections.");
  });

  it("persists server-recomputed points instead of client payload", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const bank = makeBank("bank_a", 1000);
    vi.mocked(loadBanksWithSlips).mockResolvedValue([bank]);

    const expectedPoints = buildDepositFalloffSeries(bank.depositSlips, {
      hours: 24,
      now,
    });

    let insertedPoints: unknown;
    const returning = vi.fn().mockResolvedValue([
      {
        id: "proj_1",
        bankId: "bank_a",
        name: "Snapshot",
        notes: null,
        horizonHours: 24,
        stepHours: 1,
        pointsJson: expectedPoints,
        createdAt: now,
        createdByHqUserId: "user_1",
      },
    ]);
    const values = vi.fn().mockImplementation((row: { pointsJson: unknown }) => {
      insertedPoints = row.pointsJson;
      return { returning };
    });
    vi.mocked(getDb).mockReturnValue({
      insert: vi.fn(() => ({ values })),
    } as never);

    const tamperedPoints = [
      {
        hourStartIso: now.toISOString(),
        lockedValue: 999_999,
        lockedCount: 99,
        maturingValue: 0,
      },
    ];

    const projection = await createDepositProjection("alliance_1", "user_1", {
      bankId: "bank_a",
      scope: "bank",
      name: "Snapshot",
      horizonHours: 24,
      points: tamperedPoints,
    });

    expect(insertedPoints).toEqual(expectedPoints);
    expect(projection.points).toEqual(expectedPoints);
    expect(projection.points).not.toEqual(tamperedPoints);
    vi.useRealTimers();
  });
});

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
