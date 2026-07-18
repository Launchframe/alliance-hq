import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  upsertCommanderLevel,
  decideAndMaybeApplyInboundStat,
  loadLatestNonDiscardedEventMeta,
  updateWhere,
  updateSet,
} = vi.hoisted(() => {
  const updateWhere = vi.fn(async () => undefined);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  return {
    upsertCommanderLevel: vi.fn(async () => true),
    decideAndMaybeApplyInboundStat: vi.fn(),
    loadLatestNonDiscardedEventMeta: vi.fn(),
    updateWhere,
    updateSet,
    getDb: vi.fn(() => ({
      update: vi.fn(() => ({ set: updateSet })),
    })),
  };
});

vi.mock("@/lib/member-level/repository", () => ({
  upsertCommanderLevel,
  getCommanderIdForMember: vi.fn(),
  getCommanderLevelState: vi.fn(),
  getCommanderMembershipInAlliance: vi.fn(),
}));

vi.mock("@/lib/hq-ashed-stat-sync/inbound", () => ({
  decideAndMaybeApplyInboundStat,
  loadLatestNonDiscardedEventMeta,
  pendingUnsyncedFromMeta: vi.fn(() => false),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    update: vi.fn(() => ({ set: updateSet })),
  }),
  schema: {
    commanderLevelEvents: {
      id: "commander_level_events.id",
      ashedSyncedAt: "commander_level_events.ashed_synced_at",
    },
  },
}));

import { syncCommanderLevelFromAllianceMember } from "@/lib/member-level/sync-from-member.server";

describe("syncCommanderLevelFromAllianceMember", () => {
  beforeEach(() => {
    upsertCommanderLevel.mockClear();
    decideAndMaybeApplyInboundStat.mockReset();
    loadLatestNonDiscardedEventMeta.mockReset();
    updateSet.mockClear();
    updateWhere.mockClear();
  });

  it("routes non-ashed sources through upsert with clamped total", async () => {
    const changed = await syncCommanderLevelFromAllianceMember({
      commanderId: "cmd1",
      allianceId: "a1",
      ashedMemberId: "m1",
      memberName: "Alpha",
      total: 90,
      source: "video_parse",
    });

    expect(changed).toBe(true);
    expect(decideAndMaybeApplyInboundStat).not.toHaveBeenCalled();
    expect(upsertCommanderLevel).toHaveBeenCalledWith(
      expect.objectContaining({
        total: 35,
        source: "video_parse",
      }),
    );
  });

  it("on over-cap ashed_sync apply: clamps via adapter and clears ashedSyncedAt", async () => {
    decideAndMaybeApplyInboundStat.mockImplementation(
      async (input: {
        adapter: {
          applyAshedOnHq: (args: {
            commanderId: string;
            allianceId: string;
            ashedMemberId: string;
            memberName: string;
            total: number;
            source: "ashed_sync";
          }) => Promise<boolean>;
        };
        ashedTotal: number;
        commanderId: string;
        allianceId: string;
        ashedMemberId: string;
        memberName: string;
      }) => {
        await input.adapter.applyAshedOnHq({
          commanderId: input.commanderId,
          allianceId: input.allianceId,
          ashedMemberId: input.ashedMemberId,
          memberName: input.memberName,
          total: input.ashedTotal,
          source: "ashed_sync",
        });
        return "apply";
      },
    );
    loadLatestNonDiscardedEventMeta.mockResolvedValue({
      source: "ashed_sync",
      eventId: "evt-level-1",
      ashedSyncedAt: new Date(),
      total: 35,
      createdAt: new Date(),
    });

    const changed = await syncCommanderLevelFromAllianceMember({
      commanderId: "cmd1",
      allianceId: "a1",
      ashedMemberId: "m1",
      memberName: "Alpha",
      total: 90,
      source: "ashed_sync",
    });

    expect(changed).toBe(true);
    expect(decideAndMaybeApplyInboundStat).toHaveBeenCalledWith(
      expect.objectContaining({ ashedTotal: 90 }),
    );
    expect(upsertCommanderLevel).toHaveBeenCalledWith(
      expect.objectContaining({ total: 35, source: "ashed_sync" }),
    );
    expect(updateSet).toHaveBeenCalledWith({ ashedSyncedAt: null });
    expect(updateWhere).toHaveBeenCalled();
  });

  it("does not clear ashedSyncedAt when applied Ashed level is within cap", async () => {
    decideAndMaybeApplyInboundStat.mockImplementation(async () => "apply");
    loadLatestNonDiscardedEventMeta.mockResolvedValue({
      source: "ashed_sync",
      eventId: "evt-level-2",
      ashedSyncedAt: new Date(),
      total: 30,
      createdAt: new Date(),
    });

    await syncCommanderLevelFromAllianceMember({
      commanderId: "cmd1",
      allianceId: "a1",
      ashedMemberId: "m1",
      memberName: "Alpha",
      total: 30,
      source: "ashed_sync",
    });

    expect(updateSet).not.toHaveBeenCalled();
  });

  it("skips invalid totals", async () => {
    const changed = await syncCommanderLevelFromAllianceMember({
      commanderId: "cmd1",
      allianceId: "a1",
      ashedMemberId: "m1",
      memberName: "Alpha",
      total: 0,
      source: "ashed_sync",
    });
    expect(changed).toBe(false);
    expect(decideAndMaybeApplyInboundStat).not.toHaveBeenCalled();
  });
});
