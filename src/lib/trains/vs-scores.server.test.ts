import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  base44Json: vi.fn(),
  listActiveAllianceMembersForPool: vi.fn(),
  getAllianceById: vi.fn(),
  getAllianceAshedCredential: vi.fn(),
  decryptSecret: vi.fn(),
}));

vi.mock("@/lib/base44/fetch", () => ({
  base44Json: mocks.base44Json,
}));

vi.mock("@/lib/members/roster.server", () => ({
  listActiveAllianceMembersForPool: mocks.listActiveAllianceMembersForPool,
}));

vi.mock("@/lib/vr/repository", () => ({
  getAllianceById: mocks.getAllianceById,
  getAllianceAshedCredential: mocks.getAllianceAshedCredential,
}));

vi.mock("@/lib/crypto/encrypt", () => ({
  decryptSecret: mocks.decryptSecret,
}));

import {
  fetchAllianceVsTopScorersForTrainDate,
  fetchVsScoresByRecordedDate,
  fetchVsTopScorersForTrainDate,
} from "@/lib/trains/vs-scores.server";

const CONNECTION = {
  token: "token",
  appId: "app",
  originUrl: "https://ashed.online",
};

describe("fetchVsScoresByRecordedDate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the highest score when multiple rows exist for one member", async () => {
    mocks.base44Json.mockResolvedValue([
      { member_id: "m1", score: 7_500_000 },
      { member_id: "m1", score: 7_200_000 },
      { member_id: "m2", score: 6_000_000 },
    ]);

    const scores = await fetchVsScoresByRecordedDate(
      CONNECTION,
      "alliance-1",
      "2026-07-08",
    );

    expect(scores.get("m1")).toBe(7_500_000);
    expect(scores.get("m2")).toBe(6_000_000);
  });
});

describe("fetchVsTopScorersForTrainDate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns T-1 top scorers with priorDayVsScore for the wheel", async () => {
    mocks.base44Json.mockResolvedValue([
      { member_id: "m1", member_name: "Alpha", score: 9_000_000 },
      { member_id: "m2", member_name: "Beta", score: 8_500_000 },
      { member_id: "m3", member_name: "Gamma", score: 8_000_000 },
    ]);

    const top = await fetchVsTopScorersForTrainDate(
      CONNECTION,
      "alliance-1",
      "2026-07-09",
      2,
    );

    expect(mocks.base44Json).toHaveBeenCalledWith(
      CONNECTION,
      expect.stringContaining(encodeURIComponent('"recorded_date":"2026-07-08"')),
    );
    expect(top).toEqual([
      { memberId: "m1", memberName: "Alpha", priorDayVsScore: 9_000_000 },
      { memberId: "m2", memberName: "Beta", priorDayVsScore: 8_500_000 },
    ]);
  });
});

describe("fetchAllianceVsTopScorersForTrainDate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAllianceById.mockResolvedValue({
      ashedAllianceId: "ashed-1",
      tag: "TAG",
    });
    mocks.getAllianceAshedCredential.mockResolvedValue({
      encryptedToken: "enc",
      appId: "app",
      originUrl: "https://ashed.online",
    });
    mocks.decryptSecret.mockReturnValue("token");
    mocks.listActiveAllianceMembersForPool.mockResolvedValue([
      {
        ashedMemberId: "m2",
        currentName: "Beta",
        allianceRank: 3,
      },
      {
        ashedMemberId: "m3",
        currentName: "Gamma",
        allianceRank: 4,
      },
    ]);
  });

  it("excludes former / non-roster Ashed scorers and fills Top N from active members", async () => {
    mocks.base44Json.mockResolvedValue([
      { member_id: "m1", member_name: "Departed", score: 12_000_000 },
      { member_id: "m2", member_name: "StaleName", score: 9_000_000 },
      { member_id: "m3", member_name: "Gamma", score: 8_000_000 },
      { member_id: "m4", member_name: "AlsoGone", score: 7_500_000 },
    ]);

    const top = await fetchAllianceVsTopScorersForTrainDate("hq-1", "2026-07-09", 2);

    expect(mocks.listActiveAllianceMembersForPool).toHaveBeenCalledWith("hq-1");
    expect(top).toEqual([
      {
        memberId: "m2",
        memberName: "Beta",
        allianceRank: 3,
        priorDayVsScore: 9_000_000,
      },
      {
        memberId: "m3",
        memberName: "Gamma",
        allianceRank: 4,
        priorDayVsScore: 8_000_000,
      },
    ]);
  });
});
