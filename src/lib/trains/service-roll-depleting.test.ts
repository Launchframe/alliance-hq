import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEffectiveSeasonForAlliance: vi.fn(),
  getConductorRecord: vi.fn(),
  resolveRollDayConfig: vi.fn(),
  getPoolSummary: vi.fn(),
  listUnselectedPoolEntries: vi.fn(),
  listPoolEntries: vi.fn(),
  markPoolEntrySelected: vi.fn(),
  releasePoolSelectionForDate: vi.fn(),
  pickUniformPoolEntry: vi.fn(),
  resolveConductorQualificationGateApplies: vi.fn(),
  evaluateConductorQualification: vi.fn(),
  resolvePoolRespectsConductorMinimums: vi.fn(),
  filterMemberIdsByConductorMinimums: vi.fn(),
  upsertConductorDraft: vi.fn(),
  assignVipOnLockedConductor: vi.fn(),
  getMemberRankAsOf: vi.fn(),
  refreshExhaustedPoolIfNeeded: vi.fn(),
}));

vi.mock("@/lib/game-season/sync", () => ({
  getEffectiveSeasonForAlliance: mocks.getEffectiveSeasonForAlliance,
}));

vi.mock("@/lib/trains/repository", () => ({
  getConductorRecord: mocks.getConductorRecord,
  upsertConductorDraft: mocks.upsertConductorDraft,
  assignVipOnLockedConductor: mocks.assignVipOnLockedConductor,
}));

vi.mock("@/lib/trains/day-config-resolve.server", () => ({
  resolveRollDayConfig: mocks.resolveRollDayConfig,
}));

vi.mock("@/lib/trains/pool", () => ({
  getPoolSummary: mocks.getPoolSummary,
  listUnselectedPoolEntries: mocks.listUnselectedPoolEntries,
  listPoolEntries: mocks.listPoolEntries,
  markPoolEntrySelected: mocks.markPoolEntrySelected,
  markPoolMemberSelectedForDate: vi.fn(),
  pickUniformPoolEntry: mocks.pickUniformPoolEntry,
  pickWeightedPoolEntryFromRows: vi.fn(),
  releasePoolSelectionForDate: mocks.releasePoolSelectionForDate,
  seedPool: vi.fn(),
  startNewPoolGeneration: vi.fn(),
}));

vi.mock("@/lib/trains/train-conductor-minimums.server", () => ({
  evaluateConductorQualification: mocks.evaluateConductorQualification,
  filterMemberIdsByConductorMinimums: mocks.filterMemberIdsByConductorMinimums,
  loadTrainConductorMinimums: vi.fn(),
  resolveConductorQualificationGateApplies:
    mocks.resolveConductorQualificationGateApplies,
  resolvePoolRespectsConductorMinimums: mocks.resolvePoolRespectsConductorMinimums,
}));

vi.mock("@/lib/trains/rank-history", () => ({
  getAllianceRanksAsOf: vi.fn(),
  getMemberRankAsOf: mocks.getMemberRankAsOf,
  resolveMemberPoolAllianceRank: vi.fn(),
  isMemberEligibleForPool: vi.fn(),
  memberIdsEligibleForPoolType: vi.fn(
    async (_allianceId: string, _poolType: string, _date: string, memberIds: string[]) =>
      new Set(memberIds),
  ),
}));

vi.mock("@/lib/trains/heavy-hitter-pool.server", () => ({
  buildHeavyHitterPoolCandidates: vi.fn(async () => []),
}));

vi.mock("@/lib/trains/conductor-pool-claim-lock.server", () => ({
  withConductorPoolClaimLock: vi.fn(
    async (_key: unknown, run: () => Promise<unknown>) => run(),
  ),
}));

vi.mock("@/lib/trains/native-scores.server", () => ({
  fetchNativeVrTopScorers: vi.fn(async () => []),
}));

vi.mock("@/lib/trains/train-economy-threshold.server", () => ({
  buildPriceIsRightWeightedCandidates: vi.fn(),
  loadPriceIsRightTicketSettings: vi.fn(),
}));

vi.mock("@/lib/trains/price-is-freight-roll.server", () => ({
  rollPriceIsFreightConductor: vi.fn(),
}));

vi.mock("@/lib/trains/day-spin-exclusions.server", () => ({
  listDaySpinExcludedMemberIds: vi.fn(async () => []),
  recordDaySpinExclusion: vi.fn(async () => undefined),
}));

vi.mock("@/lib/trains/vs-scores.server", () => ({
  fetchAllianceVsTopScorersForTrainDate: vi.fn(),
}));

vi.mock("@/lib/trains/vr-reporter-count.server", () => ({
  countAllianceVrReporters: vi.fn(),
}));

vi.mock("@/lib/members/game-roster", () => ({
  loadActiveAlliancePoolMembers: vi.fn(async () => []),
  loadAllianceRow: vi.fn(),
}));

vi.mock("@/lib/trains/game-time", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/trains/game-time")>();
  return {
    ...actual,
    getServerCalendarDate: () => "2099-06-15",
  };
});

vi.mock("@/lib/trains/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/trains/service")>();
  return {
    ...actual,
    refreshExhaustedPoolIfNeeded: mocks.refreshExhaustedPoolIfNeeded,
  };
});

import { rollForConductor, rollForVip } from "@/lib/trains/service";

describe("rollForConductor depleting pool release ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEffectiveSeasonForAlliance.mockResolvedValue({ seasonKey: "1" });
    mocks.resolveRollDayConfig.mockResolvedValue({
      conductorMechanism: "r3_lottery",
      paintTemplate: "economy_week",
      vipMechanism: "none",
      dayConfigId: "dc1",
    });
    mocks.getPoolSummary.mockResolvedValue({
      total: 3,
      selected: 1,
      remaining: 2,
      exhausted: false,
    });
    mocks.listUnselectedPoolEntries.mockResolvedValue([
      { id: "e-bob", memberId: "m-bob", memberName: "Bob", allianceRank: 3 },
    ]);
    mocks.listPoolEntries.mockResolvedValue([
      { id: "e-alice", memberId: "m-alice", memberName: "Alice", allianceRank: 3 },
      { id: "e-bob", memberId: "m-bob", memberName: "Bob", allianceRank: 3 },
    ]);
    mocks.pickUniformPoolEntry.mockReturnValue({
      id: "e-bob",
      memberId: "m-bob",
      memberName: "Bob",
      allianceRank: 3,
    });
    mocks.markPoolEntrySelected.mockResolvedValue(true);
    mocks.resolvePoolRespectsConductorMinimums.mockResolvedValue(false);
    mocks.filterMemberIdsByConductorMinimums.mockResolvedValue(null);
    mocks.resolveConductorQualificationGateApplies.mockResolvedValue(false);
    mocks.getMemberRankAsOf.mockResolvedValue({ id: "rank-1" });
    mocks.upsertConductorDraft.mockResolvedValue({
      conductorMemberId: "m-bob",
      lockedAt: null,
    });
    mocks.refreshExhaustedPoolIfNeeded.mockResolvedValue(false);
  });

  it("releases the prior conductor only after a successful depleting roll", async () => {
    mocks.getConductorRecord.mockResolvedValue({
      conductorMemberId: "m-alice",
      lockedAt: null,
    });

    await rollForConductor({ allianceId: "a1", date: "2099-06-20" });

    expect(mocks.markPoolEntrySelected).toHaveBeenCalledWith("e-bob", "2099-06-20");
    expect(mocks.upsertConductorDraft).toHaveBeenCalled();
    expect(mocks.releasePoolSelectionForDate).toHaveBeenCalledWith(
      "a1",
      "2099-06-20",
      "m-alice",
    );
    expect(
      mocks.markPoolEntrySelected.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.upsertConductorDraft.mock.invocationCallOrder[0]!);
    expect(
      mocks.upsertConductorDraft.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.releasePoolSelectionForDate.mock.invocationCallOrder[0]!);
  });

  it("does not release the prior conductor when qualification rejects the winner", async () => {
    mocks.getConductorRecord.mockResolvedValue({
      conductorMemberId: "m-alice",
      lockedAt: null,
    });
    mocks.resolveConductorQualificationGateApplies.mockResolvedValue(true);
    mocks.evaluateConductorQualification.mockResolvedValue({
      qualified: false,
      reasons: ["below_minimum"],
    });

    const result = await rollForConductor({
      allianceId: "a1",
      date: "2099-06-20",
    });

    expect(result.draftPersisted).toBe(false);
    expect(mocks.upsertConductorDraft).not.toHaveBeenCalled();
    expect(mocks.releasePoolSelectionForDate).toHaveBeenCalledWith(
      "a1",
      "2099-06-20",
      "m-bob",
    );
    expect(mocks.releasePoolSelectionForDate).not.toHaveBeenCalledWith(
      "a1",
      "2099-06-20",
      "m-alice",
    );
  });
});

describe("rollForVip depleting pool release ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEffectiveSeasonForAlliance.mockResolvedValue({ seasonKey: "1" });
    mocks.getConductorRecord.mockResolvedValue({
      lockedAt: new Date("2099-06-20T12:00:00Z"),
      conductorMemberId: "m-conductor",
      vipMemberId: "m-alice",
    });
    mocks.resolveRollDayConfig.mockResolvedValue({
      vipMechanism: "event_top_x_lottery",
      vipConfig: { eventKey: "capitol_war", topN: 10 },
      dayConfigId: "dc1",
    });
    mocks.getPoolSummary.mockResolvedValue({
      total: 3,
      selected: 1,
      remaining: 2,
      exhausted: false,
    });
    mocks.listUnselectedPoolEntries.mockResolvedValue([
      { id: "e-bob", memberId: "m-bob", memberName: "Bob", allianceRank: 4 },
    ]);
    mocks.listPoolEntries.mockResolvedValue([
      { id: "e-alice", memberId: "m-alice", memberName: "Alice", allianceRank: 4 },
      { id: "e-bob", memberId: "m-bob", memberName: "Bob", allianceRank: 4 },
    ]);
    mocks.pickUniformPoolEntry.mockReturnValue({
      id: "e-bob",
      memberId: "m-bob",
      memberName: "Bob",
      allianceRank: 4,
    });
    mocks.markPoolEntrySelected.mockResolvedValue(true);
    mocks.getMemberRankAsOf.mockResolvedValue({ id: "rank-1" });
    mocks.assignVipOnLockedConductor.mockResolvedValue({
      vipMemberId: "m-bob",
      lockedAt: new Date("2099-06-20T12:00:00Z"),
    });
    mocks.refreshExhaustedPoolIfNeeded.mockResolvedValue(false);
  });

  it("releases the prior VIP only after assignVipOnLockedConductor", async () => {
    await rollForVip({ allianceId: "a1", date: "2099-06-20" });

    expect(mocks.markPoolEntrySelected).toHaveBeenCalledWith("e-bob", "2099-06-20");
    expect(mocks.assignVipOnLockedConductor).toHaveBeenCalled();
    expect(mocks.releasePoolSelectionForDate).toHaveBeenCalledWith(
      "a1",
      "2099-06-20",
      "m-alice",
    );
    expect(
      mocks.markPoolEntrySelected.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.assignVipOnLockedConductor.mock.invocationCallOrder[0]!);
    expect(
      mocks.assignVipOnLockedConductor.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.releasePoolSelectionForDate.mock.invocationCallOrder[0]!);
  });
});
