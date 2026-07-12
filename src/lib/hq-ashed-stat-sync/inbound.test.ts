import { beforeEach, describe, expect, it, vi } from "vitest";

const { upsertInboundStatConflict, clearInboundStatConflict } = vi.hoisted(
  () => ({
    upsertInboundStatConflict: vi.fn(async () => undefined),
    clearInboundStatConflict: vi.fn(async () => undefined),
  }),
);

vi.mock("@/lib/hq-ashed-stat-sync/conflicts.server", () => ({
  upsertInboundStatConflict,
  clearInboundStatConflict,
  listInboundStatConflicts: vi.fn(async () => []),
}));

import { decideAndMaybeApplyInboundStat } from "@/lib/hq-ashed-stat-sync/inbound";
import type { StatSyncAdapter } from "@/lib/hq-ashed-stat-sync/types";

function makeAdapter(
  hq: Awaited<ReturnType<StatSyncAdapter["getHqCurrent"]>>,
): StatSyncAdapter {
  return {
    stat: "kills",
    ashedField: "current_kills",
    getHqCurrent: vi.fn(async () => hq),
    applyAshedOnHq: vi.fn(async () => true),
    putToAshed: vi.fn(async () => undefined),
    markEventSynced: vi.fn(async () => undefined),
    markEventDiscarded: vi.fn(async () => undefined),
    revertHqToPrevious: vi.fn(async () => null),
    listPendingOutbound: vi.fn(async () => []),
  };
}

describe("decideAndMaybeApplyInboundStat", () => {
  beforeEach(() => {
    upsertInboundStatConflict.mockClear();
    clearInboundStatConflict.mockClear();
  });

  it("persists inbound conflict when Ashed would regress protected HQ", async () => {
    const adapter = makeAdapter({
      total: 200,
      updatedAt: new Date("2026-01-02"),
      latestSource: "web",
      pendingUnsyncedSelfReport: false,
      latestEventId: "evt-hq",
    });

    const decision = await decideAndMaybeApplyInboundStat({
      adapter,
      commanderId: "cmd1",
      allianceId: "a1",
      ashedMemberId: "m1",
      memberName: "Alpha",
      ashedTotal: 100,
    });

    expect(decision).toBe("conflict");
    expect(adapter.applyAshedOnHq).not.toHaveBeenCalled();
    expect(upsertInboundStatConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        allianceId: "a1",
        stat: "kills",
        commanderId: "cmd1",
        hqTotal: 200,
        ashedTotal: 100,
        hqEventId: "evt-hq",
        hqSource: "web",
      }),
    );
    expect(clearInboundStatConflict).not.toHaveBeenCalled();
  });

  it("applies higher Ashed and clears any prior conflict", async () => {
    const adapter = makeAdapter({
      total: 100,
      updatedAt: new Date("2026-01-01"),
      latestSource: "ashed_sync",
      pendingUnsyncedSelfReport: false,
      latestEventId: "evt1",
    });

    const decision = await decideAndMaybeApplyInboundStat({
      adapter,
      commanderId: "cmd1",
      allianceId: "a1",
      ashedMemberId: "m1",
      memberName: "Alpha",
      ashedTotal: 150,
    });

    expect(decision).toBe("apply");
    expect(adapter.applyAshedOnHq).toHaveBeenCalled();
    expect(clearInboundStatConflict).toHaveBeenCalledWith({
      allianceId: "a1",
      stat: "kills",
      commanderId: "cmd1",
    });
    expect(upsertInboundStatConflict).not.toHaveBeenCalled();
  });

  it("clears conflict when totals match (noop)", async () => {
    const adapter = makeAdapter({
      total: 100,
      updatedAt: new Date("2026-01-01"),
      latestSource: "web",
      pendingUnsyncedSelfReport: true,
      latestEventId: "evt1",
    });

    const decision = await decideAndMaybeApplyInboundStat({
      adapter,
      commanderId: "cmd1",
      allianceId: "a1",
      ashedMemberId: "m1",
      memberName: "Alpha",
      ashedTotal: 100,
    });

    expect(decision).toBe("noop");
    expect(adapter.applyAshedOnHq).not.toHaveBeenCalled();
    expect(clearInboundStatConflict).toHaveBeenCalled();
    expect(upsertInboundStatConflict).not.toHaveBeenCalled();
  });
});
