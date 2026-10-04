import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPoolSummary: vi.fn(),
  listUnselectedPoolEntries: vi.fn(),
  seedPool: vi.fn(),
  startNewPoolGeneration: vi.fn(),
  filterMemberIdsByConductorMinimums: vi.fn(),
  loadActiveAlliancePoolMembers: vi.fn(),
  getAllianceRanksAsOf: vi.fn(),
  resolveMemberPoolAllianceRank: vi.fn(),
  isMemberEligibleForPool: vi.fn(),
}));

vi.mock("@/lib/trains/pool", () => ({
  getPoolSummary: mocks.getPoolSummary,
  listUnselectedPoolEntries: mocks.listUnselectedPoolEntries,
  listPoolEntries: vi.fn(),
  markPoolEntrySelected: vi.fn(),
  markPoolMemberSelectedForDate: vi.fn(),
  pickUniformPoolEntry: vi.fn(),
  pickWeightedPoolEntryFromRows: vi.fn(),
  releasePoolSelectionForDate: vi.fn(),
  seedPool: mocks.seedPool,
  startNewPoolGeneration: mocks.startNewPoolGeneration,
}));

vi.mock("@/lib/trains/train-conductor-minimums.server", () => ({
  evaluateConductorQualification: vi.fn(),
  filterMemberIdsByConductorMinimums: mocks.filterMemberIdsByConductorMinimums,
  loadTrainConductorMinimums: vi.fn(),
  resolveConductorQualificationGateApplies: vi.fn(),
  resolvePoolRespectsConductorMinimums: vi.fn(),
}));

vi.mock("@/lib/members/game-roster", () => ({
  loadActiveAlliancePoolMembers: mocks.loadActiveAlliancePoolMembers,
  loadAllianceRow: vi.fn(),
}));

vi.mock("@/lib/trains/rank-history", () => ({
  getAllianceRanksAsOf: mocks.getAllianceRanksAsOf,
  getMemberRankAsOf: vi.fn(),
  resolveMemberPoolAllianceRank: mocks.resolveMemberPoolAllianceRank,
  isMemberEligibleForPool: mocks.isMemberEligibleForPool,
  memberIdsEligibleForPoolType: vi.fn(
    async (_allianceId: string, _poolType: string, _date: string, memberIds: string[]) =>
      new Set(memberIds),
  ),
}));

vi.mock("@/lib/trains/heavy-hitter-pool.server", () => ({
  buildHeavyHitterPoolCandidates: vi.fn(async () => []),
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

vi.mock("@/lib/trains/vs-scores.server", () => ({
  fetchAllianceVsTopScorersForTrainDate: vi.fn(),
}));

vi.mock("@/lib/trains/vr-reporter-count.server", () => ({
  countAllianceVrReporters: vi.fn(),
}));

vi.mock("@/lib/trains/day-config-resolve.server", () => ({
  resolveRollDayConfig: vi.fn(),
}));

vi.mock("@/lib/trains/repository", () => ({
  clearConductorAssignment: vi.fn(),
  clearVipAssignment: vi.fn(),
  deleteWeekScheduleAndDayConfigs: vi.fn(),
  getConductorRecord: vi.fn(),
  getWeekSchedule: vi.fn(),
  listConductorRecordsForWeek: vi.fn(),
  listDayConfigsForWeek: vi.fn(),
  lockConductorRecord: vi.fn(),
  replaceDayConfigs: vi.fn(),
  assignVipOnLockedConductor: vi.fn(),
  upsertConductorDraft: vi.fn(),
  upsertDayConfigOverride: vi.fn(),
  upsertWeekSchedule: vi.fn(),
}));

vi.mock("@/lib/bff/audit", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("@/lib/game-season/sync", () => ({
  getEffectiveSeasonForAlliance: vi.fn(),
}));

import { ensureConductorPoolSeeded } from "@/lib/trains/service";

describe("ensureConductorPoolSeeded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.seedPool.mockResolvedValue({ generation: 1, count: 2 });
    mocks.startNewPoolGeneration.mockResolvedValue({ generation: 2, count: 2 });
    mocks.loadActiveAlliancePoolMembers.mockResolvedValue([
      { ashedMemberId: "alice", currentName: "Alice", allianceRank: 3 },
      { ashedMemberId: "bob", currentName: "Bob", allianceRank: 3 },
      { ashedMemberId: "carol", currentName: "Carol", allianceRank: 3 },
    ]);
    mocks.getAllianceRanksAsOf.mockResolvedValue([
      { ashedMemberId: "alice", allianceRank: 3 },
      { ashedMemberId: "bob", allianceRank: 3 },
      { ashedMemberId: "carol", allianceRank: 3 },
    ]);
    mocks.resolveMemberPoolAllianceRank.mockReturnValue(3);
    mocks.isMemberEligibleForPool.mockReturnValue(true);
    mocks.filterMemberIdsByConductorMinimums.mockResolvedValue([
      "alice",
      "bob",
      "carol",
    ]);
  });

  it("does not reseed when unselected leftovers remain but fail conductor minimums", async () => {
    mocks.getPoolSummary.mockResolvedValue({
      generation: 1,
      total: 3,
      remaining: 1,
      exhausted: false,
      nextInSequence: null,
    });
    mocks.listUnselectedPoolEntries.mockResolvedValue([
      {
        id: "entry-carol",
        memberId: "carol",
        memberName: "Carol",
        sequencePosition: 3,
      },
    ]);
    // Remaining Carol fails season HQ VR minimums.
    mocks.filterMemberIdsByConductorMinimums.mockResolvedValue([]);

    await ensureConductorPoolSeeded({
      hqAllianceId: "ally-1",
      poolType: "r3",
      date: "2026-06-18",
      useSequence: false,
      respectConductorMinimums: true,
    });

    expect(mocks.startNewPoolGeneration).not.toHaveBeenCalled();
    expect(mocks.seedPool).not.toHaveBeenCalled();
  });

  it("reseeds when the current generation is fully exhausted", async () => {
    mocks.getPoolSummary.mockResolvedValue({
      generation: 1,
      total: 3,
      remaining: 0,
      exhausted: true,
      nextInSequence: null,
    });
    mocks.listUnselectedPoolEntries.mockResolvedValue([]);

    await ensureConductorPoolSeeded({
      hqAllianceId: "ally-1",
      poolType: "r3",
      date: "2026-06-18",
      useSequence: false,
      respectConductorMinimums: true,
    });

    expect(mocks.startNewPoolGeneration).toHaveBeenCalledTimes(1);
    expect(mocks.seedPool).not.toHaveBeenCalled();
  });

  it("seeds a fresh pool when none exists yet", async () => {
    mocks.getPoolSummary.mockResolvedValue({
      generation: 1,
      total: 0,
      remaining: 0,
      exhausted: false,
      nextInSequence: null,
    });
    mocks.listUnselectedPoolEntries.mockResolvedValue([]);

    await ensureConductorPoolSeeded({
      hqAllianceId: "ally-1",
      poolType: "r3",
      date: "2026-06-18",
      useSequence: false,
      respectConductorMinimums: true,
    });

    expect(mocks.seedPool).toHaveBeenCalledTimes(1);
    expect(mocks.startNewPoolGeneration).not.toHaveBeenCalled();
  });
});
