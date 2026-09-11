import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadTimeOffAvailability: vi.fn(async () => ({ awayMemberIds: new Set<string>() })),
  seedPool: vi.fn(),
  startNewPoolGeneration: vi.fn(),
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
  loadAllianceTrainLeadTimeDays: vi.fn(),
  withConductorPoolClaimLock: vi.fn(
    async (_key: unknown, run: () => Promise<unknown>) => run(),
  ),
}));

vi.mock("@/lib/time-off/availability.server", () => ({
  loadTimeOffAvailability: mocks.loadTimeOffAvailability,
}));

vi.mock("@/lib/game-season/sync", () => ({
  getEffectiveSeasonForAlliance: mocks.getEffectiveSeasonForAlliance,
}));

vi.mock("@/lib/trains/alliance-train-lead-time.server", () => ({
  loadAllianceTrainLeadTimeDays: mocks.loadAllianceTrainLeadTimeDays,
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
  seedPool: mocks.seedPool,
  startNewPoolGeneration: mocks.startNewPoolGeneration,
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
  withConductorPoolClaimLock: mocks.withConductorPoolClaimLock,
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
    mocks.loadTimeOffAvailability.mockReset().mockResolvedValue({ awayMemberIds: new Set() });
    mocks.getEffectiveSeasonForAlliance.mockResolvedValue({ seasonKey: "1" });
    mocks.loadAllianceTrainLeadTimeDays.mockResolvedValue(0);
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

  it.each(["r3_lottery", "r4_sequence", "heavy_hitter_lottery"])("preserves an all-away %s rotation and its existing draft", async (mechanism) => {
    mocks.getConductorRecord.mockResolvedValue({ conductorMemberId: "m-alice", lockedAt: null });
    mocks.resolveRollDayConfig.mockResolvedValue({ conductorMechanism: mechanism, paintTemplate: "economy_week" });
    mocks.loadTimeOffAvailability.mockResolvedValue({ awayMemberIds: new Set(["m-bob"]) });

    await expect(rollForConductor({ allianceId: "a1", date: "2099-06-20" })).rejects.toMatchObject({ details: { code: "POOL_UNAVAILABLE" } });

    expect(mocks.loadTimeOffAvailability).toHaveBeenCalledWith("a1", "2099-06-20");
    expect(mocks.markPoolEntrySelected).not.toHaveBeenCalled();
    expect(mocks.seedPool).not.toHaveBeenCalled();
    expect(mocks.startNewPoolGeneration).not.toHaveBeenCalled();
    expect(mocks.releasePoolSelectionForDate).not.toHaveBeenCalled();
    expect(mocks.upsertConductorDraft).not.toHaveBeenCalled();
  });

  it("releases only the new claim if leave arrives before draft persistence", async () => {
    mocks.getConductorRecord.mockResolvedValue({ conductorMemberId: "m-alice", lockedAt: null });
    mocks.getMemberRankAsOf.mockImplementationOnce(async () => {
      mocks.loadTimeOffAvailability.mockResolvedValue({ awayMemberIds: new Set(["m-bob"]) });
      return null;
    });

    await expect(rollForConductor({ allianceId: "a1", date: "2099-06-20" })).rejects.toMatchObject({ details: { code: "POOL_UNAVAILABLE" } });

    expect(mocks.upsertConductorDraft).not.toHaveBeenCalled();
    expect(mocks.releasePoolSelectionForDate).toHaveBeenCalledWith("a1", "2099-06-20", "m-bob");
    expect(mocks.releasePoolSelectionForDate).not.toHaveBeenCalledWith("a1", "2099-06-20", "m-alice");
    expect(mocks.startNewPoolGeneration).not.toHaveBeenCalled();
  });

  it("passes paintTemplate when resolving conductor minimums", async () => {
    mocks.getConductorRecord.mockResolvedValue({
      conductorMemberId: null,
      lockedAt: null,
    });

    await rollForConductor({ allianceId: "a1", date: "2099-06-20" });

    expect(mocks.resolvePoolRespectsConductorMinimums).toHaveBeenCalledWith({
      allianceId: "a1",
      poolType: "r3",
      paintTemplate: "economy_week",
    });
    expect(mocks.filterMemberIdsByConductorMinimums).not.toHaveBeenCalled();
    expect(mocks.resolveConductorQualificationGateApplies).toHaveBeenCalledWith(
      expect.objectContaining({
        allianceId: "a1",
        poolType: "r3",
        paintTemplate: "economy_week",
      }),
    );
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

  it("filters conductor minimums once outside the claim loop and skips post-roll Ashed DQ", async () => {
    mocks.getConductorRecord.mockResolvedValue({
      conductorMemberId: null,
      lockedAt: null,
    });
    mocks.resolvePoolRespectsConductorMinimums.mockResolvedValue(true);
    mocks.filterMemberIdsByConductorMinimums.mockResolvedValue(["m-bob"]);
    mocks.resolveConductorQualificationGateApplies.mockResolvedValue(true);
    mocks.markPoolEntrySelected
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await rollForConductor({ allianceId: "a1", date: "2099-06-20" });

    expect(mocks.filterMemberIdsByConductorMinimums).toHaveBeenCalledTimes(1);
    expect(mocks.evaluateConductorQualification).not.toHaveBeenCalled();
    expect(mocks.markPoolEntrySelected).toHaveBeenCalledTimes(2);
    expect(mocks.upsertConductorDraft).toHaveBeenCalled();
  });
});

describe("rollForVip depleting pool release ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadTimeOffAvailability.mockReset().mockResolvedValue({ awayMemberIds: new Set() });
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

  it("does not consume or reset an event VIP rotation while its remaining member is away", async () => {
    mocks.loadTimeOffAvailability.mockResolvedValue({ awayMemberIds: new Set(["m-bob"]) });

    await expect(rollForVip({ allianceId: "a1", date: "2099-06-20" })).rejects.toMatchObject({ details: { code: "POOL_UNAVAILABLE" } });

    expect(mocks.markPoolEntrySelected).not.toHaveBeenCalled();
    expect(mocks.startNewPoolGeneration).not.toHaveBeenCalled();
    expect(mocks.releasePoolSelectionForDate).not.toHaveBeenCalled();
    expect(mocks.assignVipOnLockedConductor).not.toHaveBeenCalled();
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

  it("releases the newly claimed VIP when assignVipOnLockedConductor fails", async () => {
    mocks.assignVipOnLockedConductor.mockRejectedValue(
      new Error("Lock the conductor before assigning VIP."),
    );

    await expect(
      rollForVip({ allianceId: "a1", date: "2099-06-20" }),
    ).rejects.toThrow("Lock the conductor before assigning VIP.");

    expect(mocks.markPoolEntrySelected).toHaveBeenCalledWith("e-bob", "2099-06-20");
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

  it("keeps claim+assign+prior-release inside one pool claim lock", async () => {
    const order: string[] = [];
    mocks.withConductorPoolClaimLock.mockImplementation(
      async (_key: unknown, run: () => Promise<unknown>) => {
        order.push("lock");
        const value = await run();
        order.push("unlock");
        return value;
      },
    );
    mocks.markPoolEntrySelected.mockImplementation(async () => {
      order.push("claim");
      return true;
    });
    mocks.assignVipOnLockedConductor.mockImplementation(async () => {
      order.push("assign");
      return {
        vipMemberId: "m-bob",
        lockedAt: new Date("2099-06-20T12:00:00Z"),
      };
    });
    mocks.releasePoolSelectionForDate.mockImplementation(async () => {
      order.push("release-prior");
    });

    await rollForVip({ allianceId: "a1", date: "2099-06-20" });

    expect(order).toEqual([
      "lock",
      "claim",
      "assign",
      "release-prior",
      "unlock",
    ]);
  });
});
