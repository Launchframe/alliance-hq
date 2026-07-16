import { describe, expect, it } from "vitest";

import {
  findOverlappingLockedDepositSlips,
  mergeDepositSlipReviewRowsForSubmit,
  validateDepositSlipReviewRows,
} from "@/lib/banks/deposit-slip-review-validation.shared";
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

  it("keeps omitted persisted rows in server-side submit validation", () => {
    const merged = mergeDepositSlipReviewRowsForSubmit(
      [validRow("row-1", "flagged-1"), validRow("row-2", "flagged-1")],
      [{ id: "row-1", score: "7000" }],
    );
    const result = validateDepositSlipReviewRows(merged.rows, flaggedReport);

    expect(merged.unknownRowIds.size).toBe(0);
    expect(result.unresolvedClusterIds).toEqual(new Set(["flagged-1"]));
    expect(result.canSubmitSlips).toBe(false);
  });

  it("does not fall back to persisted values when an edit clears a required field", () => {
    const merged = mergeDepositSlipReviewRowsForSubmit(
      [validRow("row-1")],
      [{ id: "row-1", ocrName: "" }],
    );
    const result = validateDepositSlipReviewRows(merged.rows, null);

    expect(result.incompleteRowIds).toEqual(new Set(["row-1"]));
    expect(result.canSubmitSlips).toBe(false);
  });

  it("rejects submitted row IDs outside the persisted parse session", () => {
    const merged = mergeDepositSlipReviewRowsForSubmit(
      [validRow("row-1")],
      [{ id: "foreign-row", score: "7000" }],
    );

    expect(merged.unknownRowIds).toEqual(new Set(["foreign-row"]));
  });
});

describe("findOverlappingLockedDepositSlips", () => {
  it("does not flag a commander's Locked row paired with its own Matured terminal-state row", () => {
    // Same underlying deposit observed at two lifecycle stages: still open
    // (locked) in one frame, matured by the time a later frame captured it.
    const issues = findOverlappingLockedDepositSlips([
      {
        id: "locked-row",
        ocrName: "Bat Pig",
        score: "6000",
        powerLevel: "2026-07-09T12:27:55.000Z",
        memberLevel: 3,
        profession: "locked",
        deleted: false,
      },
      {
        id: "matured-row",
        ocrName: "Bat Pig",
        score: "6000",
        powerLevel: "2026-07-12T12:27:55.000Z",
        memberLevel: 3,
        profession: "matured",
        deleted: false,
      },
    ]);

    expect(issues).toEqual([]);
  });

  it("flags two simultaneously-open Locked deposits for the same commander", () => {
    const issues = findOverlappingLockedDepositSlips([
      {
        id: "locked-1",
        ocrName: "Duplicate Investor",
        score: "6000",
        powerLevel: "2026-07-09T12:00:00.000Z",
        memberLevel: 3,
        profession: "locked",
        deleted: false,
      },
      {
        id: "locked-2",
        ocrName: "Duplicate Investor",
        score: "6000",
        powerLevel: "2026-07-10T12:00:00.000Z",
        memberLevel: 3,
        profession: "locked",
        deleted: false,
      },
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0]!.memberName).toBe("Duplicate Investor");
    expect(new Set(issues[0]!.rowIds)).toEqual(
      new Set(["locked-1", "locked-2"]),
    );
  });

  it("does not flag two Locked rows for the same commander when their windows don't overlap", () => {
    // Deposit #1 already matured (term elapsed) before deposit #2 was locked —
    // sequential, legal deposits, not a duplicate investment.
    const issues = findOverlappingLockedDepositSlips([
      {
        id: "locked-1",
        ocrName: "Sequential Depositor",
        score: "6000",
        powerLevel: "2026-07-01T12:00:00.000Z",
        memberLevel: 1,
        profession: "locked",
        deleted: false,
      },
      {
        id: "locked-2",
        ocrName: "Sequential Depositor",
        score: "6000",
        powerLevel: "2026-07-09T12:00:00.000Z",
        memberLevel: 1,
        profession: "locked",
        deleted: false,
      },
    ]);

    expect(issues).toEqual([]);
  });

  it("does not flag a second Locked row missing depositAt/term (garbled OCR default) as a duplicate", () => {
    // OCR failed to read the "Total return" line, so the parser defaulted
    // status to "locked" without a usable timestamp/term. Must not treat
    // this as a duplicate investment against a real locked row.
    const issues = findOverlappingLockedDepositSlips([
      {
        id: "real-locked",
        ocrName: "Chibbs270",
        score: "6000",
        powerLevel: "2026-07-09T12:31:48.000Z",
        memberLevel: 3,
        profession: "locked",
        deleted: false,
      },
      {
        id: "garbled-locked",
        ocrName: "Chibbs270",
        score: null,
        powerLevel: "2026-07-12T12:31:48.000Z",
        memberLevel: null,
        profession: "locked",
        deleted: false,
      },
    ]);

    expect(issues).toEqual([]);
  });

  it("ignores deleted rows and rows that aren't currently locked", () => {
    const issues = findOverlappingLockedDepositSlips([
      {
        id: "locked-1",
        ocrName: "Deleted Case",
        score: "6000",
        powerLevel: "2026-07-09T12:00:00.000Z",
        memberLevel: 3,
        profession: "locked",
        deleted: true,
      },
      {
        id: "locked-2",
        ocrName: "Deleted Case",
        score: "6000",
        powerLevel: "2026-07-10T12:00:00.000Z",
        memberLevel: 3,
        profession: "locked",
        deleted: false,
      },
      {
        id: "matured-only",
        ocrName: "No Overlap Here",
        score: "6000",
        powerLevel: "2026-07-09T12:00:00.000Z",
        memberLevel: 3,
        profession: "matured",
        deleted: false,
      },
    ]);

    expect(issues).toEqual([]);
  });
});
