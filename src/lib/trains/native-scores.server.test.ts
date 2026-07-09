import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEffectiveSeasonForAlliance: vi.fn(),
  listActiveAllianceMembersForPool: vi.fn(),
  selectChain: {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
  },
}));

vi.mock("@/lib/game-season/sync", () => ({
  getEffectiveSeasonForAlliance: mocks.getEffectiveSeasonForAlliance,
}));

vi.mock("@/lib/members/roster.server", () => ({
  listActiveAllianceMembersForPool: mocks.listActiveAllianceMembersForPool,
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => mocks.selectChain,
  }),
  schema: {
    memberSeasonVr: {
      ashedMemberId: "ashedMemberId",
      highestBaseVr: "highestBaseVr",
      allianceId: "allianceId",
      seasonKey: "seasonKey",
    },
  },
}));

import {
  fetchHqSeasonVsScoresByMember,
  fetchNativeVrTopScorers,
} from "@/lib/trains/native-scores.server";

describe("fetchNativeVrTopScorers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEffectiveSeasonForAlliance.mockResolvedValue({ seasonKey: "3" });
    mocks.listActiveAllianceMembersForPool.mockResolvedValue([
      {
        ashedMemberId: "m1",
        currentName: "Alpha",
        allianceRank: 4,
      },
      {
        ashedMemberId: "m2",
        currentName: "Beta",
        allianceRank: 3,
      },
    ]);
    mocks.selectChain.from.mockReturnValue(mocks.selectChain);
    mocks.selectChain.where.mockReturnValue(mocks.selectChain);
    mocks.selectChain.orderBy.mockResolvedValue([
      { ashedMemberId: "m1", highestBaseVr: 120 },
      { ashedMemberId: "m2", highestBaseVr: 90 },
      { ashedMemberId: "ghost", highestBaseVr: 200 },
    ]);
  });

  it("returns active roster members sorted by season VR", async () => {
    const result = await fetchNativeVrTopScorers("a1", 10);
    expect(result).toEqual([
      { memberId: "m1", memberName: "Alpha", allianceRank: 4 },
      { memberId: "m2", memberName: "Beta", allianceRank: 3 },
    ]);
  });

  it("respects limit and skips zero VR", async () => {
    mocks.selectChain.orderBy.mockResolvedValue([
      { ashedMemberId: "m2", highestBaseVr: 0 },
      { ashedMemberId: "m1", highestBaseVr: 50 },
    ]);

    const result = await fetchNativeVrTopScorers("a1", 1);
    expect(result).toEqual([
      { memberId: "m1", memberName: "Alpha", allianceRank: 4 },
    ]);
  });
});

describe("fetchHqSeasonVsScoresByMember", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEffectiveSeasonForAlliance.mockResolvedValue({ seasonKey: "3" });
    mocks.selectChain.from.mockReturnValue(mocks.selectChain);
    mocks.selectChain.where.mockResolvedValue([
      { ashedMemberId: "m1", highestBaseVr: 120 },
      { ashedMemberId: "m2", highestBaseVr: 0 },
      { ashedMemberId: "m3", highestBaseVr: 45 },
    ]);
  });

  it("returns positive season VR keyed by member id", async () => {
    const scores = await fetchHqSeasonVsScoresByMember("a1");
    expect(scores.get("m1")).toBe(120);
    expect(scores.get("m3")).toBe(45);
    expect(scores.has("m2")).toBe(false);
  });

  it("scopes query to alliance season", async () => {
    await fetchHqSeasonVsScoresByMember("a1");
    expect(mocks.getEffectiveSeasonForAlliance).toHaveBeenCalledWith("a1");
    expect(mocks.selectChain.where).toHaveBeenCalled();
  });
});
