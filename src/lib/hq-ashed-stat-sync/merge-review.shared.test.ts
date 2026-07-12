import { describe, expect, it } from "vitest";

import { mergeStatSyncReviewRows } from "@/lib/hq-ashed-stat-sync/merge-review.shared";
import type { StatSyncReviewRow } from "@/lib/hq-ashed-stat-sync/types";

function outbound(partial: Partial<StatSyncReviewRow> = {}): StatSyncReviewRow {
  return {
    stat: "kills",
    commanderId: "cmd1",
    ashedMemberId: "m1",
    memberName: "Alpha",
    hqTotal: 200,
    ashedTotal: null,
    hqSource: "web",
    hqUpdatedAt: "2026-01-02T00:00:00.000Z",
    eventId: "evt1",
    reason: "pending_outbound",
    ...partial,
  };
}

function conflict(partial: Partial<StatSyncReviewRow> = {}): StatSyncReviewRow {
  return {
    stat: "kills",
    commanderId: "cmd1",
    ashedMemberId: "m1",
    memberName: "Alpha",
    hqTotal: 200,
    ashedTotal: 100,
    hqSource: "web",
    hqUpdatedAt: "2026-01-03T00:00:00.000Z",
    eventId: null,
    reason: "inbound_conflict",
    ...partial,
  };
}

describe("mergeStatSyncReviewRows", () => {
  it("returns outbound rows when there are no conflicts", () => {
    const rows = mergeStatSyncReviewRows([outbound()], []);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reason).toBe("pending_outbound");
    expect(rows[0]?.ashedTotal).toBeNull();
  });

  it("surfaces inbound conflicts with ashedTotal for officer Keep Ashed", () => {
    const rows = mergeStatSyncReviewRows([], [conflict()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reason).toBe("inbound_conflict");
    expect(rows[0]?.ashedTotal).toBe(100);
  });

  it("prefers inbound conflict over outbound for the same commander", () => {
    const rows = mergeStatSyncReviewRows(
      [outbound()],
      [conflict({ eventId: null })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reason).toBe("inbound_conflict");
    expect(rows[0]?.ashedTotal).toBe(100);
    expect(rows[0]?.eventId).toBe("evt1");
  });

  it("keeps distinct commanders from both lists", () => {
    const rows = mergeStatSyncReviewRows(
      [outbound({ commanderId: "cmd-out" })],
      [conflict({ commanderId: "cmd-in" })],
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.commanderId).sort()).toEqual(["cmd-in", "cmd-out"]);
  });
});
