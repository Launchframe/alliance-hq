import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEffectiveSeasonForAlliance: vi.fn(),
  getWeekSchedule: vi.fn(),
  upsertWeekSchedule: vi.fn(),
  upsertDayConfigOverride: vi.fn(),
  getConductorRecord: vi.fn(),
  restampConductorRules: vi.fn(),
  clearConductorAssignment: vi.fn(),
  clearVipAssignment: vi.fn(),
  listDayConfigsForWeek: vi.fn(async () => []),
  resolveRollDayConfig: vi.fn(),
  resolveAnchorTemplateType: vi.fn(),
  resolveMemberAllianceRankAsOf: vi.fn(),
  loadActiveAlliancePoolMembers: vi.fn(
    async (): Promise<Array<{ ashedMemberId: string }>> => [],
  ),
  loadAllianceRow: vi.fn(async () => ({})),
  countAllianceVrReporters: vi.fn(async () => 0),
}));

vi.mock("@/lib/time-off/availability.server", () => ({
  loadTimeOffAvailability: vi.fn(async () => ({ awayMemberIds: new Set() })),
}));

vi.mock("@/lib/game-season/sync", () => ({
  getEffectiveSeasonForAlliance: mocks.getEffectiveSeasonForAlliance,
}));

vi.mock("@/lib/trains/alliance-train-lead-time.server", () => ({
  loadAllianceTrainLeadTimeDays: vi.fn(async () => 0),
}));

vi.mock("@/lib/trains/repository", () => ({
  clearConductorAssignment: mocks.clearConductorAssignment,
  clearVipAssignment: mocks.clearVipAssignment,
  deleteWeekScheduleAndDayConfigs: vi.fn(),
  getConductorRecord: mocks.getConductorRecord,
  getWeekSchedule: mocks.getWeekSchedule,
  listConductorRecordsForWeek: vi.fn(async () => []),
  listConductorRecordsInRange: vi.fn(async () => []),
  listDayConfigsForWeek: mocks.listDayConfigsForWeek,
  lockConductorRecord: vi.fn(),
  replaceDayConfigs: vi.fn(),
  assignVipOnLockedConductor: vi.fn(),
  upsertConductorDraft: vi.fn(),
  upsertDayConfigOverride: mocks.upsertDayConfigOverride,
  upsertWeekSchedule: mocks.upsertWeekSchedule,
  restampConductorRules: mocks.restampConductorRules,
}));

vi.mock("@/lib/trains/day-config-resolve.server", () => ({
  resolveAnchorTemplateType: mocks.resolveAnchorTemplateType,
  resolveRollDayConfig: mocks.resolveRollDayConfig,
}));

vi.mock("@/lib/trains/pool", () => ({
  getPoolSummary: vi.fn(),
  listUnselectedPoolEntries: vi.fn(),
  listPoolEntries: vi.fn(),
  markPoolEntrySelected: vi.fn(),
  markPoolMemberSelectedForDate: vi.fn(),
  pickUniformPoolEntry: vi.fn(),
  pickWeightedPoolEntryFromRows: vi.fn(),
  releasePoolSelectionForDate: vi.fn(),
  seedPool: vi.fn(),
  startNewPoolGeneration: vi.fn(),
}));

vi.mock("@/lib/trains/train-conductor-minimums.server", () => ({
  evaluateConductorQualification: vi.fn(),
  filterMemberIdsByConductorMinimums: vi.fn(),
  loadTrainConductorMinimums: vi.fn(),
  resolveConductorQualificationGateApplies: vi.fn(),
  resolvePoolRespectsConductorMinimums: vi.fn(),
}));

vi.mock("@/lib/trains/rank-history", () => ({
  getAllianceRanksAsOf: vi.fn(),
  getMemberRankAsOf: vi.fn(),
  resolveMemberPoolAllianceRank: vi.fn(),
  isMemberEligibleForPool: vi.fn(),
  memberIdsEligibleForPoolType: vi.fn(),
  resolveMemberAllianceRankAsOf: mocks.resolveMemberAllianceRankAsOf,
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
  countAllianceVrReporters: mocks.countAllianceVrReporters,
}));

vi.mock("@/lib/members/game-roster", () => ({
  loadActiveAlliancePoolMembers: mocks.loadActiveAlliancePoolMembers,
  loadAllianceRow: mocks.loadAllianceRow,
}));

vi.mock("@/lib/bff/audit", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("@/lib/trains/game-time", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/trains/game-time")>();
  return {
    ...actual,
    getServerCalendarDate: () => "2099-06-15",
  };
});

import { applyPaint, applyPresetToWeek } from "@/lib/trains/service";

const DATE = "2099-06-20";

describe("applyPaint partial patches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEffectiveSeasonForAlliance.mockResolvedValue({ seasonKey: "1" });
    mocks.getWeekSchedule.mockResolvedValue({
      id: "sched-1",
      templateType: "custom",
      isPivot: 0,
    });
    mocks.loadActiveAlliancePoolMembers.mockResolvedValue([
      { ashedMemberId: "m1" },
    ]);
    mocks.getConductorRecord.mockResolvedValue(null);
  });

  it("reapplying the same conductor rule leaves the event VIP intact", async () => {
    const r4 = { kind: "rank_pool", pool: "r4_plus", draw: "wheel" } as const;
    const eventVip = {
      kind: "event_top_x",
      eventKey: "capitol_war",
      topN: 10,
    } as const;
    mocks.resolveRollDayConfig.mockResolvedValue({
      conductorRule: r4,
      vipRule: eventVip,
      dayConfigId: "dc1",
    });
    mocks.getConductorRecord.mockResolvedValue({
      conductorMemberId: "m1",
      lockedAt: null,
    });

    await applyPaint("a1", { dates: [DATE], conductorRule: r4 });

    expect(mocks.upsertDayConfigOverride).toHaveBeenCalledWith(
      "a1",
      "sched-1",
      expect.objectContaining({ conductorRule: r4, vipRule: eventVip }),
      true,
    );
    expect(mocks.restampConductorRules).not.toHaveBeenCalled();
    expect(mocks.clearConductorAssignment).not.toHaveBeenCalled();
  });

  it("a VIP-only paint restamps the record without clearing the conductor", async () => {
    const r4 = { kind: "rank_pool", pool: "r4_plus", draw: "wheel" } as const;
    mocks.resolveRollDayConfig.mockResolvedValue({
      conductorRule: r4,
      vipRule: { kind: "event_top_x", eventKey: "capitol_war", topN: 10 },
      dayConfigId: "dc1",
    });
    mocks.getConductorRecord.mockResolvedValue({
      conductorMemberId: "m1",
      lockedAt: null,
    });

    await applyPaint("a1", {
      dates: [DATE],
      vipRule: { kind: "donations_second" },
    });

    expect(mocks.upsertDayConfigOverride).toHaveBeenCalledWith(
      "a1",
      "sched-1",
      expect.objectContaining({
        conductorRule: r4,
        vipRule: { kind: "donations_second" },
      }),
      true,
    );
    expect(mocks.restampConductorRules).toHaveBeenCalledWith(
      expect.objectContaining({
        conductorRule: r4,
        vipRule: { kind: "donations_second" },
      }),
    );
    expect(mocks.clearConductorAssignment).not.toHaveBeenCalled();
    expect(mocks.clearVipAssignment).not.toHaveBeenCalled();
    expect(mocks.loadActiveAlliancePoolMembers).not.toHaveBeenCalled();
  });

  it("painting both sides writes both and restamps a kept conductor", async () => {
    mocks.resolveRollDayConfig.mockResolvedValue({
      conductorRule: { kind: "rank_pool", pool: "r4_plus", draw: "wheel" },
      vipRule: null,
      dayConfigId: "dc1",
    });
    mocks.getConductorRecord.mockResolvedValue({
      conductorMemberId: "m1",
      lockedAt: null,
    });
    mocks.resolveMemberAllianceRankAsOf.mockResolvedValue({ rank: 4 });

    const nextConductor = { kind: "vs_top_n", topN: 10 } as const;
    await applyPaint("a1", {
      dates: [DATE],
      conductorRule: nextConductor,
      vipRule: { kind: "none" },
    });

    expect(mocks.upsertDayConfigOverride).toHaveBeenCalledWith(
      "a1",
      "sched-1",
      expect.objectContaining({
        conductorRule: nextConductor,
        vipRule: { kind: "none" },
      }),
      true,
    );
    expect(mocks.restampConductorRules).toHaveBeenCalledWith(
      expect.objectContaining({
        conductorRule: nextConductor,
        vipRule: { kind: "none" },
      }),
    );
    expect(mocks.clearConductorAssignment).not.toHaveBeenCalled();
  });

  it("clears a provably ineligible unlocked conductor when the rule changes", async () => {
    mocks.resolveRollDayConfig.mockResolvedValue({
      conductorRule: { kind: "vs_top_n", topN: 10 },
      vipRule: null,
      dayConfigId: "dc1",
    });
    mocks.getConductorRecord.mockResolvedValue({
      conductorMemberId: "m1",
      vipMemberId: "m2",
      lockedAt: null,
    });
    mocks.resolveMemberAllianceRankAsOf.mockResolvedValue({ rank: 2 });

    await applyPaint("a1", {
      dates: [DATE],
      conductorRule: { kind: "rank_pool", pool: "r3", draw: "wheel" },
    });

    expect(mocks.clearConductorAssignment).toHaveBeenCalledWith(
      "a1",
      DATE,
      "1",
    );
    expect(mocks.clearVipAssignment).toHaveBeenCalledWith("a1", DATE, "1");
  });

  it("rejects an empty patch without touching the repository", async () => {
    await applyPaint("a1", { dates: [DATE] });

    expect(mocks.getWeekSchedule).not.toHaveBeenCalled();
    expect(mocks.upsertDayConfigOverride).not.toHaveBeenCalled();
  });
});

describe("applyPresetToWeek", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEffectiveSeasonForAlliance.mockResolvedValue({ seasonKey: "1" });
    mocks.getWeekSchedule.mockResolvedValue({
      id: "sched-1",
      templateType: "custom",
      isPivot: 0,
    });
    mocks.loadActiveAlliancePoolMembers.mockResolvedValue([
      { ashedMemberId: "m1" },
    ]);
  });

  it("keeps an assigned conductor who stays eligible under the preset", async () => {
    mocks.resolveRollDayConfig.mockResolvedValue({
      conductorRule: { kind: "rank_pool", pool: "r4_plus", draw: "wheel" },
      vipRule: null,
      dayConfigId: "dc1",
    });
    mocks.getConductorRecord.mockResolvedValue({
      conductorMemberId: "m1",
      lockedAt: null,
    });
    mocks.resolveMemberAllianceRankAsOf.mockResolvedValue({ rank: 4 });

    await applyPresetToWeek("a1", "2099-06-15", "r4_train_week");

    expect(mocks.upsertDayConfigOverride).toHaveBeenCalledTimes(7);
    expect(mocks.clearConductorAssignment).not.toHaveBeenCalled();
  });

  it("clears a provably ineligible unlocked conductor under the preset", async () => {
    mocks.resolveRollDayConfig.mockResolvedValue({
      conductorRule: { kind: "rank_pool", pool: "r4_plus", draw: "wheel" },
      vipRule: null,
      dayConfigId: "dc1",
    });
    mocks.getConductorRecord.mockResolvedValue({
      conductorMemberId: "m1",
      lockedAt: null,
    });
    mocks.resolveMemberAllianceRankAsOf.mockResolvedValue({ rank: 4 });

    await applyPresetToWeek("a1", "2099-06-15", "economy_week");

    expect(mocks.upsertDayConfigOverride).toHaveBeenCalledTimes(7);
    expect(mocks.clearConductorAssignment).toHaveBeenCalledTimes(7);
  });

  it("persists the requested pivot flag after the seven paints", async () => {
    mocks.resolveRollDayConfig.mockResolvedValue({
      conductorRule: null,
      vipRule: null,
      dayConfigId: "dc1",
    });
    mocks.getConductorRecord.mockResolvedValue(null);

    await applyPresetToWeek("a1", "2099-06-15", "economy_week", {
      isPivot: true,
    });

    expect(mocks.upsertWeekSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        weekStart: "2099-06-15",
        templateType: "economy_week",
        isPivot: true,
      }),
    );
  });
});

describe("applyPresetToWeek past days", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEffectiveSeasonForAlliance.mockResolvedValue({ seasonKey: "1" });
    mocks.getWeekSchedule.mockResolvedValue({
      id: "sched-1",
      templateType: "custom",
      isPivot: 0,
    });
    mocks.loadActiveAlliancePoolMembers.mockResolvedValue([]);
    mocks.resolveRollDayConfig.mockResolvedValue({
      conductorRule: null,
      vipRule: null,
      dayConfigId: "dc1",
    });
    mocks.getConductorRecord.mockResolvedValue(null);
  });

  it("skips days before server today for officers instead of failing", async () => {
    await applyPresetToWeek("a1", "2099-06-14", "economy_week");

    expect(mocks.upsertDayConfigOverride).toHaveBeenCalledTimes(6);
  });

  it("paints past days for a platform-admin override", async () => {
    await applyPresetToWeek("a1", "2099-06-14", "economy_week", {
      platformAdminPastOverride: true,
    });

    expect(mocks.upsertDayConfigOverride).toHaveBeenCalledTimes(7);
  });
});
