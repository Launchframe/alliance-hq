import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadTimeOffAvailability: vi.fn<(allianceId: string, date: string) => Promise<{ awayMemberIds: Set<string> }>>(),
  getEffectiveSeasonForAlliance: vi.fn(),
  getConductorRecord: vi.fn(),
  resolveRollDayConfig: vi.fn(),
  fetchAllianceVsTopScorersForTrainDate: vi.fn(),
  listDaySpinExcludedMemberIds: vi.fn(),
  recordDaySpinExclusion: vi.fn(),
  upsertConductorDraft: vi.fn(),
  getMemberRankAsOf: vi.fn(),
  resolveConductorQualificationGateApplies: vi.fn(),
  releasePoolSelectionForDate: vi.fn(),
  loadAllianceTrainLeadTimeDays: vi.fn(),
}));

vi.mock("@/lib/time-off/availability.server", () => ({
  loadTimeOffAvailability: mocks.loadTimeOffAvailability,
}));

vi.mock("@/lib/game-season/sync", () => ({
  getEffectiveSeasonForAlliance: mocks.getEffectiveSeasonForAlliance,
}));

vi.mock("@/lib/trains/repository", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/trains/repository")>();
  return {
    ...actual,
    getConductorRecord: mocks.getConductorRecord,
    upsertConductorDraft: mocks.upsertConductorDraft,
  };
});

vi.mock("@/lib/trains/day-config-resolve.server", () => ({
  resolveRollDayConfig: mocks.resolveRollDayConfig,
}));

vi.mock("@/lib/trains/vs-scores.server", () => ({
  fetchAllianceVsTopScorersForTrainDate:
    mocks.fetchAllianceVsTopScorersForTrainDate,
}));

vi.mock("@/lib/trains/alliance-train-lead-time.server", () => ({
  loadAllianceTrainLeadTimeDays: mocks.loadAllianceTrainLeadTimeDays,
}));

vi.mock("@/lib/trains/day-spin-exclusions.server", () => ({
  listDaySpinExcludedMemberIds: mocks.listDaySpinExcludedMemberIds,
  recordDaySpinExclusion: mocks.recordDaySpinExclusion,
}));

vi.mock("@/lib/trains/pool", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/trains/pool")>();
  return {
    ...actual,
    releasePoolSelectionForDate: mocks.releasePoolSelectionForDate,
  };
});

vi.mock("@/lib/trains/rank-history", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/trains/rank-history")>();
  return {
    ...actual,
    getMemberRankAsOf: mocks.getMemberRankAsOf,
  };
});

vi.mock("@/lib/trains/train-conductor-minimums.server", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/trains/train-conductor-minimums.server")
    >();
  return {
    ...actual,
    resolveConductorQualificationGateApplies:
      mocks.resolveConductorQualificationGateApplies,
  };
});

vi.mock("@/lib/trains/game-time", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/trains/game-time")>();
  return {
    ...actual,
    getServerCalendarDate: () => "2099-06-15",
  };
});

import { rollForConductor } from "@/lib/trains/service";

const top3 = [
  { memberId: "m-a", memberName: "Alice", allianceRank: 4, priorDayVsScore: 300 },
  { memberId: "m-b", memberName: "Bob", allianceRank: 3, priorDayVsScore: 200 },
  { memberId: "m-c", memberName: "Carol", allianceRank: 3, priorDayVsScore: 100 },
];

describe("rollForConductor day-scoped spin exclusions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadTimeOffAvailability.mockReset().mockResolvedValue({ awayMemberIds: new Set() });
    mocks.getEffectiveSeasonForAlliance.mockResolvedValue({ seasonKey: "3" });
    mocks.loadAllianceTrainLeadTimeDays.mockResolvedValue(0);
    mocks.getConductorRecord.mockResolvedValue(null);
    mocks.resolveRollDayConfig.mockResolvedValue({
      conductorMechanism: "vs_top_n",
      conductorConfig: { topN: 3, paintTemplate: "top_vs" },
      vipMechanism: "none",
      dayConfigId: "dc1",
      paintTemplate: "top_vs",
    });
    mocks.fetchAllianceVsTopScorersForTrainDate.mockResolvedValue(top3);
    mocks.listDaySpinExcludedMemberIds.mockResolvedValue([]);
    mocks.recordDaySpinExclusion.mockResolvedValue(undefined);
    mocks.upsertConductorDraft.mockResolvedValue({});
    mocks.getMemberRankAsOf.mockResolvedValue(null);
    mocks.resolveConductorQualificationGateApplies.mockResolvedValue(false);
  });

  it("filters Top VS on the duty date rather than the lead-time score date", async () => {
    mocks.loadAllianceTrainLeadTimeDays.mockResolvedValue(2);
    mocks.loadTimeOffAvailability.mockImplementation(async (_allianceId?: string, date?: string) => ({ awayMemberIds: new Set(date === "2099-06-20" ? ["m-a", "m-c"] : ["m-b"]) }));

    const result = await rollForConductor({ allianceId: "a1", date: "2099-06-20" });

    expect(result.memberId).toBe("m-b");
    expect(result.wheelCandidates?.map((candidate) => candidate.memberId)).toEqual(["m-b"]);
    expect(mocks.loadTimeOffAvailability.mock.calls.every((call) => call[1] === "2099-06-20")).toBe(true);
  });

  it("does not persist or exclude a Top VS winner who leaves during the rank lookup", async () => {
    mocks.loadTimeOffAvailability.mockResolvedValue({ awayMemberIds: new Set(["m-b", "m-c"]) });
    mocks.getMemberRankAsOf.mockImplementationOnce(async () => {
      mocks.loadTimeOffAvailability.mockResolvedValue({ awayMemberIds: new Set(["m-a", "m-b", "m-c"]) });
      return null;
    });

    await expect(rollForConductor({ allianceId: "a1", date: "2099-06-20" })).rejects.toMatchObject({ details: { code: "POOL_UNAVAILABLE" } });
    expect(mocks.upsertConductorDraft).not.toHaveBeenCalled();
    expect(mocks.recordDaySpinExclusion).not.toHaveBeenCalled();
  });

  it("does not replace an away Top 1 winner with an invented lower-ranked winner", async () => {
    mocks.resolveRollDayConfig.mockResolvedValue({ conductorMechanism: "vs_high_score" });
    mocks.fetchAllianceVsTopScorersForTrainDate.mockResolvedValue([top3[0]]);
    mocks.loadTimeOffAvailability.mockResolvedValue({ awayMemberIds: new Set(["m-a"]) });
    await expect(rollForConductor({ allianceId: "a1", date: "2099-06-20" })).rejects.toMatchObject({ details: { code: "POOL_UNAVAILABLE" } });
    expect(mocks.upsertConductorDraft).not.toHaveBeenCalled();
  });

  it("records the drawn Top VS winner for the rest of the calendar day", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const result = await rollForConductor({
      allianceId: "a1",
      date: "2099-06-20",
    });

    expect(result.memberId).toBe("m-a");
    expect(mocks.recordDaySpinExclusion).toHaveBeenCalledWith({
      allianceId: "a1",
      date: "2099-06-20",
      memberId: "m-a",
      memberName: "Alice",
    });
    vi.spyOn(Math, "random").mockRestore();
  });

  it("excludes previously drawn Top VS members on re-spin", async () => {
    mocks.listDaySpinExcludedMemberIds.mockResolvedValue(["m-a"]);
    mocks.getConductorRecord.mockResolvedValue({
      conductorMemberId: "m-a",
      lockedAt: null,
    });
    vi.spyOn(Math, "random").mockReturnValue(0);

    const result = await rollForConductor({
      allianceId: "a1",
      date: "2099-06-20",
    });

    expect(result.memberId).toBe("m-b");
    expect(result.wheelCandidates?.map((c) => c.memberId)).toEqual([
      "m-b",
      "m-c",
    ]);
    vi.spyOn(Math, "random").mockRestore();
  });

  it("fails when every Top VS member was already drawn today", async () => {
    mocks.listDaySpinExcludedMemberIds.mockResolvedValue([
      "m-a",
      "m-b",
      "m-c",
    ]);

    await expect(
      rollForConductor({ allianceId: "a1", date: "2099-06-20" }),
    ).rejects.toMatchObject({
      name: "TrainRollError",
      details: { code: "NO_WHEEL_CANDIDATES", candidateKind: "vs" },
    });
    expect(mocks.recordDaySpinExclusion).not.toHaveBeenCalled();
  });

  it("does not record day exclusions for Top VS scope 1", async () => {
    mocks.resolveRollDayConfig.mockResolvedValue({
      conductorMechanism: "vs_high_score",
      vipMechanism: "none",
      dayConfigId: "dc1",
      paintTemplate: null,
    });
    mocks.fetchAllianceVsTopScorersForTrainDate.mockResolvedValue([top3[0]]);

    await rollForConductor({ allianceId: "a1", date: "2099-06-20" });

    expect(mocks.listDaySpinExcludedMemberIds).not.toHaveBeenCalled();
    expect(mocks.recordDaySpinExclusion).not.toHaveBeenCalled();
  });
});
