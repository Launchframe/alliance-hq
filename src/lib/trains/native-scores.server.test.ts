import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEffectiveSeasonForAlliance: vi.fn(),
  listActiveAllianceMembersForPool: vi.fn(),
  listAllianceSeasonVrForLeaderboard: vi.fn(),
}));

vi.mock("@/lib/game-season/sync", () => ({
  getEffectiveSeasonForAlliance: mocks.getEffectiveSeasonForAlliance,
}));

vi.mock("@/lib/members/roster.server", () => ({
  listActiveAllianceMembersForPool: mocks.listActiveAllianceMembersForPool,
}));

vi.mock("@/lib/vr/repository", () => ({
  listAllianceSeasonVrForLeaderboard: mocks.listAllianceSeasonVrForLeaderboard,
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
    mocks.listAllianceSeasonVrForLeaderboard.mockResolvedValue([
      {
        commanderId: "c1",
        ashedMemberId: "m1",
        highestBaseVr: 120,
        instituteLevel: null,
        flaggedAt: null,
        flagReason: null,
        updatedAt: new Date(),
      },
      {
        commanderId: "c2",
        ashedMemberId: "m2",
        highestBaseVr: 90,
        instituteLevel: null,
        flaggedAt: null,
        flagReason: null,
        updatedAt: new Date(),
      },
      {
        commanderId: "c3",
        ashedMemberId: "ghost",
        highestBaseVr: 200,
        instituteLevel: null,
        flaggedAt: null,
        flagReason: null,
        updatedAt: new Date(),
      },
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
    mocks.listAllianceSeasonVrForLeaderboard.mockResolvedValue([
      {
        commanderId: "c2",
        ashedMemberId: "m2",
        highestBaseVr: 0,
        instituteLevel: null,
        flaggedAt: null,
        flagReason: null,
        updatedAt: new Date(),
      },
      {
        commanderId: "c1",
        ashedMemberId: "m1",
        highestBaseVr: 50,
        instituteLevel: null,
        flaggedAt: null,
        flagReason: null,
        updatedAt: new Date(),
      },
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
    mocks.listAllianceSeasonVrForLeaderboard.mockResolvedValue([
      {
        commanderId: "c1",
        ashedMemberId: "m1",
        highestBaseVr: 120,
        instituteLevel: null,
        flaggedAt: null,
        flagReason: null,
        updatedAt: new Date(),
      },
      {
        commanderId: "c2",
        ashedMemberId: "m2",
        highestBaseVr: 0,
        instituteLevel: null,
        flaggedAt: null,
        flagReason: null,
        updatedAt: new Date(),
      },
      {
        commanderId: "c3",
        ashedMemberId: "m3",
        highestBaseVr: 45,
        instituteLevel: null,
        flaggedAt: null,
        flagReason: null,
        updatedAt: new Date(),
      },
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
    expect(mocks.listAllianceSeasonVrForLeaderboard).toHaveBeenCalledWith(
      "a1",
      "3",
    );
  });
});
