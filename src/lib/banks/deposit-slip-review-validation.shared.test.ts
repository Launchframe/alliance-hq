import { describe, expect, it } from "vitest";

import { validateDepositSlipReviewRows } from "@/lib/banks/deposit-slip-review-validation.shared";
import type { DedupeReport } from "@/lib/video/dedupe/merge-report.shared";

const flaggedReport: DedupeReport = {
  clusters: [
    {
      clusterId: "flagged-1",
      disposition: "flagged",
      reason: "timestamp_collision_different_commanders",
      destinationSlipId: "row-1",
      members: [
        { slipId: "row-1", snapshot: {} },
        { slipId: "row-2", snapshot: {} },
      ],
    },
    {
      clusterId: "merged-1",
      disposition: "auto_merged",
      reason: "same_commander_timestamp_conflicting_amount_or_term",
      destinationSlipId: "row-3",
      members: [
        { slipId: "row-3", snapshot: {} },
        { slipId: "row-4", snapshot: {} },
      ],
    },
  ],
  autoMergedCount: 1,
  flaggedCount: 1,
  inputCount: 4,
  outputCount: 3,
};

function validRow(id: string, dedupeClusterId: string | null = null) {
  return {
    id,
    ocrName: `Commander ${id}`,
    score: "6000",
    powerLevel: "2026-07-11T10:00:00.000Z",
    memberLevel: 1,
    dedupeClusterId,
    deleted: false,
  };
}

describe("validateDepositSlipReviewRows", () => {
  it("blocks when two active rows remain in a flagged cluster", () => {
    const result = validateDepositSlipReviewRows(
      [
        validRow("row-1", "flagged-1"),
        validRow("row-2", "flagged-1"),
        validRow("row-3", "merged-1"),
        validRow("row-4", "merged-1"),
      ],
      flaggedReport,
    );

    expect(result.unresolvedClusterIds).toEqual(new Set(["flagged-1"]));
    expect(result.hasUnresolvedFlaggedClusters).toBe(true);
    expect(result.canSubmitSlips).toBe(false);
  });

  it("allows flagged clusters after extras are deleted", () => {
    const result = validateDepositSlipReviewRows(
      [
        validRow("row-1", "flagged-1"),
        { ...validRow("row-2", "flagged-1"), deleted: true },
      ],
      flaggedReport,
    );

    expect(result.unresolvedClusterIds.size).toBe(0);
    expect(result.hasUnresolvedFlaggedClusters).toBe(false);
    expect(result.canSubmitSlips).toBe(true);
  });

  it("blocks incomplete active rows before submit", () => {
    const result = validateDepositSlipReviewRows(
      [
        validRow("complete"),
        { ...validRow("missing-name"), ocrName: "" },
        { ...validRow("missing-amount"), score: null },
        { ...validRow("missing-date"), powerLevel: null },
        { ...validRow("missing-term"), memberLevel: null },
        { ...validRow("deleted-incomplete"), score: null, deleted: true },
      ],
      null,
    );

    expect(result.incompleteRowIds).toEqual(
      new Set(["missing-name", "missing-amount", "missing-date", "missing-term"]),
    );
    expect(result.canSubmitSlips).toBe(false);
  });
});
