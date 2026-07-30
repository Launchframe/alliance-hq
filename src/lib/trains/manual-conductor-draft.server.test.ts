import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEffectiveSeasonForAlliance: vi.fn(),
  resolveRollDayConfig: vi.fn(),
  getConductorRecord: vi.fn(),
  upsertConductorDraft: vi.fn(),
  getMemberRankAsOf: vi.fn(),
  resolveMemberAllianceRankAsOf: vi.fn(),
  isMemberEligibleForPool: vi.fn(),
  listUnselectedPoolEntries: vi.fn(),
  listPoolEntries: vi.fn(),
  markPoolMemberSelectedForDate: vi.fn(),
  releasePoolSelectionForDate: vi.fn(),
  ensureConductorPoolSeeded: vi.fn(),
  loadActiveAlliancePoolMembers: vi.fn(),
}));

vi.mock("@/lib/game-season/sync", () => ({
  getEffectiveSeasonForAlliance: mocks.getEffectiveSeasonForAlliance,
}));

vi.mock("@/lib/trains/day-config-resolve.server", () => ({
  resolveRollDayConfig: mocks.resolveRollDayConfig,
}));

vi.mock("@/lib/trains/repository", () => ({
  getConductorRecord: mocks.getConductorRecord,
  upsertConductorDraft: mocks.upsertConductorDraft,
}));

vi.mock("@/lib/trains/rank-history", () => ({
  getMemberRankAsOf: mocks.getMemberRankAsOf,
  resolveMemberAllianceRankAsOf: mocks.resolveMemberAllianceRankAsOf,
  isMemberEligibleForPool: mocks.isMemberEligibleForPool,
}));

vi.mock("@/lib/trains/pool", () => ({
  listUnselectedPoolEntries: mocks.listUnselectedPoolEntries,
  listPoolEntries: mocks.listPoolEntries,
  markPoolMemberSelectedForDate: mocks.markPoolMemberSelectedForDate,
  releasePoolSelectionForDate: mocks.releasePoolSelectionForDate,
}));

vi.mock("@/lib/trains/conductor-pool-claim-lock.server", () => ({
  withConductorPoolClaimLock: async (
    _key: unknown,
    run: () => Promise<unknown>,
  ) => run(),
}));

vi.mock("@/lib/trains/service", () => ({
  ensureConductorPoolSeeded: mocks.ensureConductorPoolSeeded,
}));

vi.mock("@/lib/trains/conductor-pool-claim-lock.server", () => ({
  withConductorPoolClaimLock: vi.fn(
    async (_key: unknown, run: () => Promise<unknown>) => run(),
  ),
}));

vi.mock("@/lib/members/game-roster", () => ({
  loadActiveAlliancePoolMembers: mocks.loadActiveAlliancePoolMembers,
}));

import { applyManualConductorDraft } from "@/lib/trains/manual-conductor-draft.server";

describe("applyManualConductorDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEffectiveSeasonForAlliance.mockResolvedValue({ seasonKey: "S1" });
    mocks.getConductorRecord.mockResolvedValue(null);
    mocks.getMemberRankAsOf.mockResolvedValue({ id: "rank-1" });
    mocks.upsertConductorDraft.mockResolvedValue({
      id: "rec-1",
      conductorMemberId: "m-alice",
      lockedAt: null,
    });
    mocks.ensureConductorPoolSeeded.mockResolvedValue(undefined);
    mocks.markPoolMemberSelectedForDate.mockResolvedValue(true);
    mocks.releasePoolSelectionForDate.mockResolvedValue(undefined);
  });

  it("consumes a depleting r3 pool slot on Discord/web manual draft", async () => {
    mocks.resolveRollDayConfig.mockResolvedValue({
      conductorMechanism: "r3_lottery",
      vipMechanism: "conductor_pick",
      paintTemplate: "economy_week",
      dayConfigId: "dc-1",
    });
    mocks.listUnselectedPoolEntries.mockResolvedValue([
      { memberId: "m-alice" },
      { memberId: "m-bob" },
    ]);
    mocks.listPoolEntries.mockResolvedValue([
      { memberId: "m-alice" },
      { memberId: "m-bob" },
    ]);

    await applyManualConductorDraft({
      allianceId: "ally-1",
      date: "2026-07-27",
      memberId: "m-alice",
      memberName: "Alice",
    });

    expect(mocks.ensureConductorPoolSeeded).toHaveBeenCalledWith(
      expect.objectContaining({
        hqAllianceId: "ally-1",
        poolType: "r3",
        date: "2026-07-27",
      }),
    );
    expect(mocks.markPoolMemberSelectedForDate).toHaveBeenCalledWith(
      "ally-1",
      "r3",
      "m-alice",
      "2026-07-27",
    );
    expect(mocks.upsertConductorDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        conductorMemberId: "m-alice",
        conductorMechanism: "r3_lottery",
      }),
    );
  });

  it("rejects re-awarding a member already selected in the current generation", async () => {
    mocks.resolveRollDayConfig.mockResolvedValue({
      conductorMechanism: "r3_lottery",
      vipMechanism: "conductor_pick",
      paintTemplate: "economy_week",
      dayConfigId: "dc-1",
    });
    mocks.listUnselectedPoolEntries.mockResolvedValue([{ memberId: "m-bob" }]);
    mocks.listPoolEntries.mockResolvedValue([
      { memberId: "m-alice" },
      { memberId: "m-bob" },
    ]);

    await expect(
      applyManualConductorDraft({
        allianceId: "ally-1",
        date: "2026-07-27",
        memberId: "m-alice",
        memberName: "Alice",
      }),
    ).rejects.toThrow(/already selected from the current pool generation/i);

    expect(mocks.markPoolMemberSelectedForDate).not.toHaveBeenCalled();
    expect(mocks.upsertConductorDraft).not.toHaveBeenCalled();
  });

  it("does not mark depleting pools for Price Is Freight paint templates", async () => {
    mocks.resolveRollDayConfig.mockResolvedValue({
      conductorMechanism: "r3_lottery",
      vipMechanism: "conductor_pick",
      paintTemplate: "price_is_right",
      dayConfigId: "dc-1",
    });

    await applyManualConductorDraft({
      allianceId: "ally-1",
      date: "2026-07-27",
      memberId: "m-alice",
      memberName: "Alice",
    });

    expect(mocks.ensureConductorPoolSeeded).not.toHaveBeenCalled();
    expect(mocks.markPoolMemberSelectedForDate).not.toHaveBeenCalled();
    expect(mocks.upsertConductorDraft).toHaveBeenCalled();
  });
});
