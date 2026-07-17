import { describe, expect, it } from "vitest";

import {
  aggregateDepositSlipOcrEvalSnapshots,
  type DepositSlipOcrEvalSnapshotMetrics,
} from "@/lib/banks/deposit-slip-ocr/deposit-slip-ocr-eval-snapshots.server";

const baseMetrics: DepositSlipOcrEvalSnapshotMetrics = {
  computedAt: "2026-06-01T12:00:00.000Z",
  primaryRowCount: 20,
  shadowRowCount: 18,
  rowCountDelta: 2,
  matchedRowCount: 17,
  onlyInPrimary: 3,
  onlyInShadow: 1,
  rowRecall: 0.85,
  rowPrecision: 0.94,
  depositAtAgreement: 0.9,
  primaryMissingDepositAtRate: 0.5,
  shadowMissingDepositAtRate: 0.1,
  amountAgreement: 0.95,
  termDaysAgreement: 1,
  statusAgreement: 0.98,
  rawLineCount: 1000,
  uniqueLineCount: 603,
};

describe("aggregateDepositSlipOcrEvalSnapshots", () => {
  it("returns a zeroed aggregate for no rows", () => {
    const result = aggregateDepositSlipOcrEvalSnapshots([]);
    expect(result.jobCount).toBe(0);
    expect(result.avgRowRecall).toBeNull();
    expect(result.avgLineReductionRate).toBeNull();
    expect(result.dailySeries).toHaveLength(0);
  });

  it("drops null metricsJson rows without throwing", () => {
    const result = aggregateDepositSlipOcrEvalSnapshots([
      { metricsJson: null, createdAt: new Date("2026-06-01T00:00:00.000Z") },
      { metricsJson: baseMetrics, createdAt: new Date("2026-06-01T00:00:00.000Z") },
    ]);
    expect(result.jobCount).toBe(1);
  });

  it("averages the headline timestamp-miss-rate metric this pass targets", () => {
    const result = aggregateDepositSlipOcrEvalSnapshots([
      { metricsJson: baseMetrics, createdAt: new Date("2026-06-01T00:00:00.000Z") },
      {
        metricsJson: { ...baseMetrics, shadowMissingDepositAtRate: 0.3 },
        createdAt: new Date("2026-06-02T00:00:00.000Z"),
      },
    ]);

    expect(result.jobCount).toBe(2);
    expect(result.avgPrimaryMissingDepositAtRate).toBeCloseTo(0.5);
    expect(result.avgShadowMissingDepositAtRate).toBeCloseTo(0.2);
  });

  it("computes line-reduction rate from raw vs. unique line counts", () => {
    const result = aggregateDepositSlipOcrEvalSnapshots([
      { metricsJson: baseMetrics, createdAt: new Date("2026-06-01T00:00:00.000Z") },
    ]);
    // 1 - 603/1000 = 0.397, matching the row-fingerprint spike's measured reduction.
    expect(result.avgLineReductionRate).toBeCloseTo(0.397);
  });

  it("skips line-reduction rate when raw line count is zero or missing", () => {
    const result = aggregateDepositSlipOcrEvalSnapshots([
      {
        metricsJson: { ...baseMetrics, rawLineCount: 0, uniqueLineCount: 0 },
        createdAt: new Date("2026-06-01T00:00:00.000Z"),
      },
      {
        metricsJson: { ...baseMetrics, rawLineCount: null, uniqueLineCount: null },
        createdAt: new Date("2026-06-01T00:00:00.000Z"),
      },
    ]);
    expect(result.avgLineReductionRate).toBeNull();
  });

  it("builds a daily series bucketed by createdAt date", () => {
    const result = aggregateDepositSlipOcrEvalSnapshots([
      { metricsJson: baseMetrics, createdAt: new Date("2026-06-01T08:00:00.000Z") },
      { metricsJson: baseMetrics, createdAt: new Date("2026-06-01T20:00:00.000Z") },
      { metricsJson: baseMetrics, createdAt: new Date("2026-06-02T08:00:00.000Z") },
    ]);

    expect(result.dailySeries).toEqual([
      expect.objectContaining({ date: "2026-06-01", jobCount: 2 }),
      expect.objectContaining({ date: "2026-06-02", jobCount: 1 }),
    ]);
  });
});
