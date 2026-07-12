import { describe, expect, it } from "vitest";

import { useDepositSlipReviewValidation } from "@/components/video/DepositSlipVideoReviewTable";
import type { DedupeReport } from "@/lib/video/dedupe/merge-report.shared";

// Hook-shaped helper is plain logic — call the validation function directly.
describe("useDepositSlipReviewValidation flagged clusters", () => {
  const report: DedupeReport = {
    clusters: [
      {
        clusterId: "c1",
        disposition: "flagged",
        reason: "timestamp_collision_different_commanders",
        destinationSlipId: "a",
        members: [
          { slipId: "a", snapshot: {} },
          { slipId: "b", snapshot: {} },
        ],
      },
    ],
    autoMergedCount: 0,
    flaggedCount: 1,
    inputCount: 2,
    outputCount: 2,
  };

  it("blocks submit while two active flagged rows share a cluster", () => {
    const result = useDepositSlipReviewValidation(
      [
        {
          id: "a",
          ocrName: "Alpha",
          score: "6000",
          powerLevel: "2026-07-11T10:00:00.000Z",
          memberLevel: 1,
          profession: "locked",
          allianceRankTitle: "LFgo",
          rosterRankRaw: null,
          dedupeClusterId: "c1",
          deleted: 0,
        },
        {
          id: "b",
          ocrName: "Beta",
          score: "6000",
          powerLevel: "2026-07-11T10:00:00.000Z",
          memberLevel: 1,
          profession: "locked",
          allianceRankTitle: "LFgo",
          rosterRankRaw: null,
          dedupeClusterId: "c1",
          deleted: 0,
        },
      ],
      report,
    );
    expect(result.hasUnresolvedFlaggedClusters).toBe(true);
    expect(result.canSubmitSlips).toBe(false);
  });

  it("allows submit after deleting extras in a flagged cluster", () => {
    const result = useDepositSlipReviewValidation(
      [
        {
          id: "a",
          ocrName: "Alpha",
          score: "6000",
          powerLevel: "2026-07-11T10:00:00.000Z",
          memberLevel: 1,
          profession: "locked",
          allianceRankTitle: "LFgo",
          rosterRankRaw: null,
          dedupeClusterId: "c1",
          deleted: 0,
        },
        {
          id: "b",
          ocrName: "Beta",
          score: "6000",
          powerLevel: "2026-07-11T10:00:00.000Z",
          memberLevel: 1,
          profession: "locked",
          allianceRankTitle: "LFgo",
          rosterRankRaw: null,
          dedupeClusterId: "c1",
          deleted: 1,
        },
      ],
      report,
    );
    expect(result.hasUnresolvedFlaggedClusters).toBe(false);
    expect(result.canSubmitSlips).toBe(true);
  });
});
