import { describe, expect, it } from "vitest";

import { aggregateOcrEvalByArm, aggregateOcrEvalSnapshots } from "@/lib/video/ocr-eval-snapshots.server";

const baseMetrics = {
  nameRecall: 0.9,
  namePrecision: 0.8,
  rankAgreement: 0.75,
  powerAgreement: null,
  levelAgreement: null,
  primaryRowCount: 10,
  shadowRowCount: 9,
  rowCountDelta: 1,
  matchedNameCount: 9,
  onlyInPrimary: 1,
  onlyInShadow: 0,
};

describe("aggregateOcrEvalSnapshots", () => {
  it("aggregates by pass key and builds daily series", () => {
    const result = aggregateOcrEvalSnapshots([
      {
        nativePassKey: "roster_ocr_scale_2_psm_6",
        metricsJson: { ...baseMetrics, computedAt: "2026-06-01T12:00:00.000Z" },
        createdAt: new Date("2026-06-01T12:00:00.000Z"),
        experimentArmId: null,
        primaryEngine: "ashed",
      },
      {
        nativePassKey: "roster_ocr_scale_3_psm_6",
        metricsJson: {
          ...baseMetrics,
          nameRecall: 0.95,
          computedAt: "2026-06-02T12:00:00.000Z",
        },
        createdAt: new Date("2026-06-02T12:00:00.000Z"),
        experimentArmId: "arm-b",
        primaryEngine: "ashed",
      },
    ]);

    expect(result.jobCount).toBe(2);
    expect(result.byPassKey).toHaveLength(2);
    expect(result.dailySeries).toHaveLength(2);
    expect(result.byPrimaryEngine[0]?.primaryEngine).toBe("ashed");
  });
});

describe("aggregateOcrEvalByArm", () => {
  it("groups metrics by experiment arm", () => {
    const result = aggregateOcrEvalByArm([
      {
        experimentArmId: "arm-a",
        metricsJson: { ...baseMetrics, computedAt: "2026-06-01T12:00:00.000Z" },
      },
      {
        experimentArmId: "arm-a",
        metricsJson: {
          ...baseMetrics,
          nameRecall: 0.7,
          computedAt: "2026-06-02T12:00:00.000Z",
        },
      },
      {
        experimentArmId: "arm-b",
        metricsJson: {
          ...baseMetrics,
          nameRecall: 0.5,
          computedAt: "2026-06-02T12:00:00.000Z",
        },
      },
      { experimentArmId: null, metricsJson: null },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]?.armId).toBe("arm-a");
    expect(result[0]?.jobCount).toBe(2);
    expect(result[0]?.avgNameRecall).toBeCloseTo(0.8);
    expect(result[1]?.armId).toBe("arm-b");
    expect(result[1]?.jobCount).toBe(1);
  });
});
