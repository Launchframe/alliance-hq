import { beforeEach, describe, expect, it, vi } from "vitest";

const { upsertInboundStatConflict, clearInboundStatConflict } = vi.hoisted(
  () => ({
    upsertInboundStatConflict: vi.fn(async () => undefined),
    clearInboundStatConflict: vi.fn(async () => undefined),
  }),
);

const { lockState, fakeTx, withActivityTransaction } = vi.hoisted(() => {
  const lockState = {
    rows: [{ id: "cmd1" }] as { id: string }[],
    onLock: null as null | (() => void),
    calls: 0,
  };
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => chain,
    for: async (mode: string) => {
      if (mode !== "update") throw new Error("expected FOR UPDATE");
      lockState.calls += 1;
      lockState.onLock?.();
      return lockState.rows;
    },
  };
  const fakeTx = { select: vi.fn(() => chain) };
  return {
    lockState,
    fakeTx,
    withActivityTransaction: vi.fn(
      async (work: (tx: unknown) => Promise<unknown>) => work(fakeTx),
    ),
  };
});

vi.mock("@/lib/activity/writer.server", () => ({ withActivityTransaction }));

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
    withActivityTransaction.mockClear();
    lockState.rows = [{ id: "cmd1" }];
    lockState.onLock = null;
    lockState.calls = 0;
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
      tx: fakeTx,
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
  it("reads HQ, writes, and clears conflicts inside the locked transaction", async () => {
    const order: string[] = [];
    lockState.onLock = () => order.push("lock");
    const adapter = makeAdapter({
      total: 100,
      updatedAt: new Date("2026-01-01"),
      latestSource: "ashed_sync",
      pendingUnsyncedSelfReport: false,
      latestEventId: "evt1",
    });
    vi.mocked(adapter.getHqCurrent).mockImplementation(async () => {
      order.push("read");
      return {
        total: 100,
        updatedAt: new Date("2026-01-01"),
        latestSource: "ashed_sync",
        pendingUnsyncedSelfReport: false,
        latestEventId: "evt1",
      };
    });
    vi.mocked(adapter.applyAshedOnHq).mockImplementation(async () => {
      order.push("apply");
      return true;
    });
    const afterApply = vi.fn(async () => {
      order.push("afterApply");
    });

    const decision = await decideAndMaybeApplyInboundStat({
      adapter,
      commanderId: "cmd1",
      allianceId: "a1",
      ashedMemberId: "m1",
      memberName: "Alpha",
      ashedTotal: 150.4,
      afterApply,
    });

    expect(decision).toBe("apply");
    expect(withActivityTransaction).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["lock", "read", "apply", "afterApply"]);
    expect(adapter.getHqCurrent).toHaveBeenCalledWith("cmd1", fakeTx);
    expect(adapter.applyAshedOnHq).toHaveBeenCalledWith(
      expect.objectContaining({
        commanderId: "cmd1",
        total: 150,
        source: "ashed_sync",
        tx: fakeTx,
      }),
    );
    expect(afterApply).toHaveBeenCalledWith(fakeTx);
    expect(clearInboundStatConflict).toHaveBeenCalledWith(
      expect.objectContaining({ commanderId: "cmd1", tx: fakeTx }),
    );
  });

  it("decides from HQ state re-read under the lock, so a newer higher HQ submit is not overwritten", async () => {
    // HQ was 100 (ashed_sync) when the sync started; a web submit of 500
    // commits while this transaction waits for the commander row lock.
    let hqState = {
      total: 100 as number | null,
      updatedAt: new Date("2026-01-01") as Date | null,
      latestSource: "ashed_sync" as string | null,
      pendingUnsyncedSelfReport: false,
      latestEventId: "evt-old" as string | null,
    };
    lockState.onLock = () => {
      hqState = {
        total: 500,
        updatedAt: new Date("2026-01-03"),
        latestSource: "web",
        pendingUnsyncedSelfReport: true,
        latestEventId: "evt-web",
      };
    };
    const adapter = makeAdapter(hqState);
    vi.mocked(adapter.getHqCurrent).mockImplementation(async () => hqState);
    const afterApply = vi.fn(async () => undefined);

    const decision = await decideAndMaybeApplyInboundStat({
      adapter,
      commanderId: "cmd1",
      allianceId: "a1",
      ashedMemberId: "m1",
      memberName: "Alpha",
      ashedTotal: 200,
      afterApply,
    });

    expect(decision).toBe("conflict");
    expect(adapter.applyAshedOnHq).not.toHaveBeenCalled();
    expect(afterApply).not.toHaveBeenCalled();
    expect(upsertInboundStatConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        hqTotal: 500,
        ashedTotal: 200,
        hqSource: "web",
        hqEventId: "evt-web",
        tx: fakeTx,
      }),
    );
  });

  it("fails closed when the commander row is missing", async () => {
    lockState.rows = [];
    const adapter = makeAdapter({
      total: null,
      updatedAt: null,
      latestSource: null,
      pendingUnsyncedSelfReport: false,
      latestEventId: null,
    });

    await expect(
      decideAndMaybeApplyInboundStat({
        adapter,
        commanderId: "missing",
        allianceId: "a1",
        ashedMemberId: "m1",
        memberName: "Alpha",
        ashedTotal: 150,
      }),
    ).rejects.toThrow("commander_not_found");
    expect(lockState.calls).toBe(1);
    expect(adapter.getHqCurrent).not.toHaveBeenCalled();
    expect(adapter.applyAshedOnHq).not.toHaveBeenCalled();
    expect(upsertInboundStatConflict).not.toHaveBeenCalled();
    expect(clearInboundStatConflict).not.toHaveBeenCalled();
  });

  it("does not run afterApply for noop or conflict decisions", async () => {
    const afterApply = vi.fn(async () => undefined);
    const adapter = makeAdapter({
      total: 100,
      updatedAt: new Date("2026-01-01"),
      latestSource: "web",
      pendingUnsyncedSelfReport: true,
      latestEventId: "evt1",
    });

    await decideAndMaybeApplyInboundStat({
      adapter,
      commanderId: "cmd1",
      allianceId: "a1",
      ashedMemberId: "m1",
      memberName: "Alpha",
      ashedTotal: 100,
      afterApply,
    });
    await decideAndMaybeApplyInboundStat({
      adapter,
      commanderId: "cmd1",
      allianceId: "a1",
      ashedMemberId: "m1",
      memberName: "Alpha",
      ashedTotal: 50,
      afterApply,
    });

    expect(afterApply).not.toHaveBeenCalled();
    expect(clearInboundStatConflict).toHaveBeenCalledWith(
      expect.objectContaining({ tx: fakeTx }),
    );
    expect(upsertInboundStatConflict).toHaveBeenCalledWith(
      expect.objectContaining({ hqTotal: 100, ashedTotal: 50, tx: fakeTx }),
    );
  });
});
