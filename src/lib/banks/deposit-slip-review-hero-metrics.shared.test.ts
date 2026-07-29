import { describe, expect, it } from "vitest";

import { computeDepositSlipReviewHeroMetrics } from "@/lib/banks/deposit-slip-review-hero-metrics.shared";

const NOW = new Date("2026-07-15T12:00:00.000Z");

describe("computeDepositSlipReviewHeroMetrics", () => {
  const bank = {
    currentDepositCount: 100,
    cityListSnapshotAt: "2026-07-10T08:00:00.000Z",
    depositSlips: [
      {
        id: "s1",
        bankId: "b1",
        depositAt: "2026-07-01T00:00:00.000Z",
        termDays: 3 as const,
        maturesAt: "2026-07-20T00:00:00.000Z",
        status: "locked" as const,
        outcomeAt: null,
        amount: 1000,
        outcomeAmount: null,
        depositAllianceTag: null,
        depositAllianceId: null,
        commanderName: "Alpha",
        commanderId: null,
        allianceMemberId: null,
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
      {
        id: "s2",
        bankId: "b1",
        depositAt: "2026-06-01T00:00:00.000Z",
        termDays: 1 as const,
        maturesAt: "2026-06-02T00:00:00.000Z",
        status: "matured" as const,
        outcomeAt: "2026-06-02T00:00:00.000Z",
        amount: 500,
        outcomeAmount: 500,
        depositAllianceTag: null,
        depositAllianceId: null,
        commanderName: "Beta",
        commanderId: null,
        allianceMemberId: null,
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-02T00:00:00.000Z",
      },
      {
        id: "s3",
        bankId: "b1",
        depositAt: "2026-05-01T00:00:00.000Z",
        termDays: 1 as const,
        maturesAt: "2026-05-02T00:00:00.000Z",
        status: "looted" as const,
        outcomeAt: "2026-05-02T00:00:00.000Z",
        amount: 200,
        outcomeAmount: 0,
        depositAllianceTag: null,
        depositAllianceId: null,
        commanderName: "Gamma",
        commanderId: null,
        allianceMemberId: null,
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
      },
    ],
  };

  it("combines HQ and video active counts with City List goal", () => {
    const metrics = computeDepositSlipReviewHeroMetrics({
      bank,
      reviewRows: [
        { deleted: 0, profession: "locked" },
        { deleted: 0, profession: "matured" },
        { deleted: 1, profession: "locked" },
      ],
      now: NOW,
    });
    expect(metrics).toEqual({
      active: {
        known: 2,
        goal: 100,
        snapshotAtIso: "2026-07-10T08:00:00.000Z",
      },
      matured: { hqTotal: 1, inVideo: 1 },
      looted: { hqTotal: 1, inVideo: 0 },
    });
  });

  it("falls back to alliance import time when per-bank snapshot is missing", () => {
    const metrics = computeDepositSlipReviewHeroMetrics({
      bank: { ...bank, cityListSnapshotAt: null },
      reviewRows: [],
      allianceCityListImportedAt: "2026-07-09T10:00:00.000Z",
      now: NOW,
    });
    expect(metrics?.active.snapshotAtIso).toBe("2026-07-09T10:00:00.000Z");
  });

  it("returns null when bank is missing", () => {
    expect(
      computeDepositSlipReviewHeroMetrics({
        bank: null,
        reviewRows: [],
      }),
    ).toBeNull();
  });
});
