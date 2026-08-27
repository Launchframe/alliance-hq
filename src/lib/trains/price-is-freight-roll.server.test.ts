import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadActiveAlliancePoolMembers: vi.fn(),
  getAllianceRanksAsOf: vi.fn(),
  filterMemberIdsByConductorMinimums: vi.fn(),
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

import { loadPriceIsFreightR3Candidates } from "@/lib/trains/price-is-freight-roll.server";

describe("loadPriceIsFreightR3Candidates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
