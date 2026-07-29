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

  it("does not double-count a video-locked row that is a re-OCR of an existing active HQ slip", () => {
    const metrics = computeDepositSlipReviewHeroMetrics({
      bank,
      reviewRows: [
        // Same deposit as HQ slip s1 (Alpha, 1000, 3d, same depositAt) —
        // deposits are unique by [bank, commander, depositAt], so this
        // re-OCR must not add to the Active count on top of hqActive.
        {
          deleted: 0,
          profession: "locked",
          ocrName: "Alpha",
          score: "1000",
          powerLevel: "2026-07-01T00:00:00.000Z",
          memberLevel: 3,
        },
        // A genuinely new locked deposit — must still be counted.
        {
          deleted: 0,
          profession: "locked",
          ocrName: "Delta",
          score: "2000",
          powerLevel: "2026-07-14T00:00:00.000Z",
          memberLevel: 1,
        },
      ],
      now: NOW,
    });
    expect(metrics?.active.known).toBe(2);
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
