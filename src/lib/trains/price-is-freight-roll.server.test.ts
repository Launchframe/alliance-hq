import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadActiveAlliancePoolMembers: vi.fn(),
  getAllianceRanksAsOf: vi.fn(),
  filterMemberIdsByConductorMinimums: vi.fn(),
  loadTimeOffAvailability: vi.fn(),
  buildHeavyHitterPoolCandidates: vi.fn(),
  loadPriceIsRightTicketSettings: vi.fn(),
  buildPriceIsRightWeightedCandidates: vi.fn(),
  fetchAlliancePriorDayVsScoresByMember: vi.fn(),
}));

vi.mock("@/lib/members/game-roster", () => ({
  loadActiveAlliancePoolMembers: mocks.loadActiveAlliancePoolMembers,
}));

vi.mock("@/lib/trains/rank-history", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/trains/rank-history")>();
  return {
    ...actual,
    getAllianceRanksAsOf: mocks.getAllianceRanksAsOf,
  };
});

vi.mock("@/lib/trains/train-conductor-minimums.server", () => ({
  filterMemberIdsByConductorMinimums: mocks.filterMemberIdsByConductorMinimums,
}));

vi.mock("@/lib/time-off/availability.server", () => ({ loadTimeOffAvailability: mocks.loadTimeOffAvailability }));
vi.mock("@/lib/trains/heavy-hitter-pool.server", () => ({ buildHeavyHitterPoolCandidates: mocks.buildHeavyHitterPoolCandidates }));
vi.mock("@/lib/trains/alliance-train-lead-time.server", () => ({ loadAllianceTrainLeadTimeDays: vi.fn(async () => 2) }));
vi.mock("@/lib/trains/train-economy-threshold.server", () => ({
  loadPriceIsRightTicketSettings: mocks.loadPriceIsRightTicketSettings,
  buildPriceIsRightWeightedCandidates: mocks.buildPriceIsRightWeightedCandidates,
  loadTrainEconomyThreshold: vi.fn(async () => ({ thresholdPoints: null, fudgePercent: 0 })),
}));
vi.mock("@/lib/trains/vs-scores.server", () => ({ fetchAlliancePriorDayVsScoresByMember: mocks.fetchAlliancePriorDayVsScoresByMember }));

import { loadPriceIsFreightR3Candidates, rollPriceIsFreightConductor } from "@/lib/trains/price-is-freight-roll.server";

describe("loadPriceIsFreightR3Candidates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadTimeOffAvailability.mockResolvedValue({ awayMemberIds: new Set() });
    mocks.loadActiveAlliancePoolMembers.mockResolvedValue([
      { ashedMemberId: "m1", currentName: "Alpha", allianceRank: 3 },
      { ashedMemberId: "m2", currentName: "Beta", allianceRank: 3 },
    ]);
    mocks.getAllianceRanksAsOf.mockResolvedValue([
      { ashedMemberId: "m1", allianceRank: 3 },
      { ashedMemberId: "m2", allianceRank: 3 },
    ]);
    mocks.filterMemberIdsByConductorMinimums.mockResolvedValue(["m1"]);
  });

  it.each([false, true])("filters away R3s from PIF with weighting=%s without changing minimums", async (weighted) => {
    mocks.loadTimeOffAvailability.mockResolvedValue({ awayMemberIds: new Set(["m1"]) });
    mocks.filterMemberIdsByConductorMinimums.mockResolvedValue(null);
    mocks.loadPriceIsRightTicketSettings.mockResolvedValue({ weightingEnabled: weighted, maxTicketMemberIds: [] });
    mocks.buildPriceIsRightWeightedCandidates.mockImplementation(async ({ candidates }: { candidates: Array<{ memberId: string; memberName: string }> }) => ({ candidates: candidates.map((candidate) => ({ ...candidate, ticketCount: 1 })) }));
    mocks.fetchAlliancePriorDayVsScoresByMember.mockResolvedValue(new Map([["m1", 7200000], ["m2", 7200000]]));

    const result = await rollPriceIsFreightConductor({ allianceId: "ally-1", date: "2026-06-10", paintTemplate: "price_is_right", mechanism: "r3_lottery" });
    expect(result.memberId).toBe("m2");
    expect(result.wheelCandidates?.map((candidate) => candidate.memberId)).toEqual(["m2"]);
    expect(mocks.loadTimeOffAvailability).toHaveBeenCalledWith("ally-1", "2026-06-10");
  });

  it("filters Saturday max-ticket overrides while preserving the configured list", async () => {
    const candidates = [{ memberId: "m1", memberName: "Alpha" }, { memberId: "m2", memberName: "Beta" }];
    mocks.buildHeavyHitterPoolCandidates.mockResolvedValue(candidates);
    mocks.filterMemberIdsByConductorMinimums.mockResolvedValue(null);
    mocks.loadTimeOffAvailability.mockResolvedValue({ awayMemberIds: new Set(["m1"]) });
    const result = await rollPriceIsFreightConductor({ allianceId: "ally-1", date: "2026-06-13", paintTemplate: "takedown_week", mechanism: "heavy_hitter_lottery" });
    expect(result.memberId).toBe("m2");
    expect(result.wheelCandidates).toEqual([candidates[1]]);
    expect(candidates).toHaveLength(2);
  });

  it("passes paint and lead time into conductor minimums filtering", async () => {
    await loadPriceIsFreightR3Candidates({
      allianceId: "ally-1",
      date: "2026-06-10",
      paintTemplate: "price_is_right",
      leadDays: 1,
    });

    expect(mocks.filterMemberIdsByConductorMinimums).toHaveBeenCalledWith(
      "ally-1",
      "2026-06-10",
      ["m1", "m2"],
      { paintTemplate: "price_is_right", leadDays: 1 },
    );
  });

  it("returns minimum-qualified R3 candidates", async () => {
    const candidates = await loadPriceIsFreightR3Candidates({
      allianceId: "ally-1",
      date: "2026-06-10",
      paintTemplate: "price_is_right",
      leadDays: 1,
    });

    expect(candidates).toEqual([
      { memberId: "m1", memberName: "Alpha", allianceRank: 3 },
    ]);
  });
});
