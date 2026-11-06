import { describe, expect, it } from "vitest";

import type { RbacContext } from "@/lib/rbac/context";

import { mergeDataDateSummaries } from "./batch-actions.server";
import type { DataBatchRow } from "./batch-authorization.shared";
import type { AshedDateScoreRow } from "./ashed-date-scores.server";

const rbac = {
  hqUserId: "user-1",
  roleName: "owner",
  permissions: new Set(["alliance:admin", "data:read"]),
} as RbacContext;

function ledgerBatch(
  overrides: Partial<DataBatchRow> & Pick<DataBatchRow, "recordedDate">,
): DataBatchRow {
  return {
    id: "batch-1",
    allianceId: "alliance-1",
    scoreTarget: "desert-storm",
    submitEntity: "DesertStormScore",
    contextJson: {},
    rowCount: 2,
    sourceJobId: null,
    parseSessionId: null,
    createdByHqUserId: "user-1",
    submittedAt: "2026-01-02T00:00:00.000Z",
    status: "active",
    movedToDate: null,
    deletedAt: null,
    ...overrides,
  };
}

describe("mergeDataDateSummaries", () => {
  it("builds ledger-only summaries without Ashed rows", () => {
    const summaries = mergeDataDateSummaries({
      ashedByDate: new Map(),
      ledgerBatches: [ledgerBatch({ recordedDate: "2026-01-02", rowCount: 5 })],
      rbac,
    });
    expect(summaries).toEqual([
      expect.objectContaining({
        recordedDate: "2026-01-02",
        rowCount: 5,
        teamACount: 0,
        teamBCount: 0,
        canMove: true,
        canDelete: true,
      }),
    ]);
  });

  it("merges Ashed-only dates and prefers Ashed row counts", () => {
    const ashedByDate = new Map<string, AshedDateScoreRow[]>([
      [
        "2026-01-03",
        [
          {
            id: "a1",
            memberId: "m1",
            memberName: "Alpha",
            score: 10,
            rank: 1,
            team: "A",
            recordedDate: "2026-01-03",
          },
          {
            id: "b1",
            memberId: "m2",
            memberName: "Beta",
            score: 9,
            rank: 2,
            team: "B",
            recordedDate: "2026-01-03",
          },
        ],
      ],
    ]);
    const summaries = mergeDataDateSummaries({
      ashedByDate,
      ledgerBatches: [ledgerBatch({ recordedDate: "2026-01-02", rowCount: 1 })],
      rbac,
    });
    expect(summaries.map((row) => row.recordedDate)).toEqual([
      "2026-01-03",
      "2026-01-02",
    ]);
    expect(summaries[0]).toEqual(
      expect.objectContaining({
        recordedDate: "2026-01-03",
        rowCount: 2,
        teamACount: 1,
        teamBCount: 1,
      }),
    );
  });
});
