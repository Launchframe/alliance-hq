import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEffectiveSeasonForAlliance: vi.fn(),
  getConductorRecord: vi.fn(),
  resolveRollDayConfig: vi.fn(),
  fetchAllianceVsTopScorersForTrainDate: vi.fn(),
  listTopScoreSpinExcludedMemberIds: vi.fn(),
  recordTopScoreSpinExclusion: vi.fn(),
  upsertConductorDraft: vi.fn(),
  getMemberRankAsOf: vi.fn(),
  resolveConductorQualificationGateApplies: vi.fn(),
  releasePoolSelectionForDate: vi.fn(),
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

vi.mock("@/lib/trains/top-score-spin-exclusions.server", () => ({
  listTopScoreSpinExcludedMemberIds: mocks.listTopScoreSpinExcludedMemberIds,
  recordTopScoreSpinExclusion: mocks.recordTopScoreSpinExclusion,
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

describe("rollForConductor Top VS day-scoped exclusions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEffectiveSeasonForAlliance.mockResolvedValue({ seasonKey: "3" });
    mocks.getConductorRecord.mockResolvedValue(null);
    mocks.resolveRollDayConfig.mockResolvedValue({
      conductorMechanism: "vs_top_n",
      conductorConfig: { topN: 3, paintTemplate: "top_vs" },
      vipMechanism: "none",
      dayConfigId: "dc1",
      paintTemplate: "top_vs",
    });
    mocks.fetchAllianceVsTopScorersForTrainDate.mockResolvedValue(top3);
    mocks.listTopScoreSpinExcludedMemberIds.mockResolvedValue([]);
    mocks.recordTopScoreSpinExclusion.mockResolvedValue(undefined);
    mocks.upsertConductorDraft.mockResolvedValue({});
    mocks.getMemberRankAsOf.mockResolvedValue(null);
    mocks.resolveConductorQualificationGateApplies.mockResolvedValue(false);
  });

  it("records the drawn winner for the rest of the calendar day", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const result = await rollForConductor({
      allianceId: "a1",
      date: "2099-06-20",
    });

    expect(result.memberId).toBe("m-a");
    expect(mocks.recordTopScoreSpinExclusion).toHaveBeenCalledWith({
      allianceId: "a1",
      date: "2099-06-20",
      memberId: "m-a",
      memberName: "Alice",
    });
    vi.spyOn(Math, "random").mockRestore();
  });

  it("excludes previously drawn members on re-spin", async () => {
    mocks.listTopScoreSpinExcludedMemberIds.mockResolvedValue(["m-a"]);
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
    mocks.listTopScoreSpinExcludedMemberIds.mockResolvedValue([
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
    expect(mocks.recordTopScoreSpinExclusion).not.toHaveBeenCalled();
  });
});
