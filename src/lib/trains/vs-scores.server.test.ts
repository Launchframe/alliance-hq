import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  base44Json: vi.fn(),
  listActiveAllianceMembersForPool: vi.fn(),
  getAllianceById: vi.fn(),
  getAllianceAshedCredential: vi.fn(),
  decryptSecret: vi.fn(),
  listVsHeads: vi.fn().mockResolvedValue([]),
  loadTrainTopScoreEligibility: vi.fn(),
  getAllianceRanksAsOf: vi.fn().mockResolvedValue([]),
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

vi.mock("@/lib/vs-scores/repository.server", () => ({ listVsHeads: mocks.listVsHeads }));

vi.mock("@/lib/trains/train-top-score-eligibility.server", () => ({
  loadTrainTopScoreEligibility: mocks.loadTrainTopScoreEligibility,
}));

vi.mock("@/lib/trains/rank-history", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/trains/rank-history")>();
  return { ...actual, getAllianceRanksAsOf: mocks.getAllianceRanksAsOf };
});

beforeEach(() => {
  mocks.listVsHeads.mockResolvedValue([]);
  mocks.loadTrainTopScoreEligibility.mockResolvedValue({
    trainTopScoreIncludesR4Plus: true,
    canManage: false,
  });
  mocks.getAllianceRanksAsOf.mockResolvedValue([]);
});

import {
  fetchAlliancePriorDayVsScoresByMember,
  fetchAllianceVsDay1To5CoverageForDay6,
  fetchAllianceVsScoresForEvaluationPeriod,
  fetchAllianceVsTopScorersForTrainDate,
  fetchVsScoresByRecordedDate,
  fetchVsTopScorersForRecordedDate,
  fetchVsTopScorersForTrainDate,
} from "@/lib/trains/vs-scores.server";

const CONNECTION = {
  token: "token",
  appId: "app",
  originUrl: "https://ashed.online",
};

describe("native daily VS", () => {
  it("uses local raw/derived scores and preserves zero without requesting Ashed", async () => {
    vi.clearAllMocks();
    mocks.getAllianceById.mockResolvedValue({ operatingMode: "native" });
    mocks.listVsHeads.mockResolvedValue([
      { memberId: "m1", score: 0, origin: "hq" },
      { memberId: "m2", score: 7_200_000, origin: "derived" },
      { memberId: "m3", score: null, origin: "hq" },
    ]);
    expect(await fetchAlliancePriorDayVsScoresByMember("native-a", "2026-09-05")).toEqual(new Map([["m1", 0], ["m2", 7_200_000]]));
    expect(mocks.base44Json).not.toHaveBeenCalled();
    expect(mocks.getAllianceAshedCredential).not.toHaveBeenCalled();
  });
});

describe("fetchVsScoresByRecordedDate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses formatted scores and rejects missing values instead of inventing zero", async () => {
    mocks.base44Json.mockResolvedValue([{ member_id: "m1", score: "7,200,000" }]);
    expect((await fetchVsScoresByRecordedDate(CONNECTION, "a", "2026-09-01")).get("m1")).toBe(7_200_000);
    mocks.base44Json.mockResolvedValue([{ member_id: "m1" }]);
    await expect(fetchVsScoresByRecordedDate(CONNECTION, "a", "2026-09-01")).rejects.toMatchObject({ code: "invalid_score" });
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

  it("excludes weekly week-ending totals from daily score maps", async () => {
    mocks.base44Json.mockResolvedValue([
      { member_id: "m1", score: 50_000_000, is_weekly: true },
      { member_id: "m2", score: 8_000_000, is_weekly: false },
      { member_id: "m3", score: 7_500_000 },
    ]);

    const scores = await fetchVsScoresByRecordedDate(
      CONNECTION,
      "alliance-1",
      "2026-07-12",
    );

    expect(scores.has("m1")).toBe(false);
    expect(scores.get("m2")).toBe(8_000_000);
    expect(scores.get("m3")).toBe(7_500_000);
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
  
  it("dedupes duplicate Ashed rows for the same member before slicing Top N", async () => {
    mocks.base44Json.mockResolvedValue([
      { member_id: "m1", member_name: "Alpha", score: 9_000_000 },
      { member_id: "m1", member_name: "Alpha", score: 8_900_000 },
      { member_id: "m2", member_name: "Beta", score: 8_500_000 },
      { member_id: "m3", member_name: "Gamma", score: 8_000_000 },
    ]);

    const top = await fetchVsTopScorersForTrainDate(
      CONNECTION,
      "alliance-1",
      "2026-07-09",
      2,
    );

    expect(top).toEqual([
      { memberId: "m1", memberName: "Alpha", priorDayVsScore: 9_000_000 },
      { memberId: "m2", memberName: "Beta", priorDayVsScore: 8_500_000 },
    ]);
  });
  
  it("does not use Sunday weekly totals for Monday Top VS rolls", async () => {
    mocks.base44Json.mockResolvedValue([
      {
        member_id: "m1",
        member_name: "WeekWinner",
        score: 80_000_000,
        is_weekly: true,
      },
      {
        member_id: "m2",
        member_name: "AlsoWeekly",
        score: 70_000_000,
        isWeekly: true,
      },
    ]);

    // 2026-07-13 is Monday → T−1 Sunday week-ending date.
    const top = await fetchVsTopScorersForTrainDate(
      CONNECTION,
      "alliance-1",
      "2026-07-13",
      10,
    );

    expect(top).toEqual([]);
    expect(mocks.base44Json).not.toHaveBeenCalled();
  });

  it("ignores weekly rows if Ashed is queried for a Sunday recorded_date", async () => {
    mocks.base44Json.mockResolvedValue([
      {
        member_id: "m1",
        member_name: "WeekWinner",
        score: 80_000_000,
        is_weekly: true,
      },
      {
        member_id: "m2",
        member_name: "DailyOnly",
        score: 9_000_000,
        is_weekly: false,
      },
    ]);

    const top = await fetchVsTopScorersForRecordedDate(
      CONNECTION,
      "alliance-1",
      "2026-07-12",
      10,
    );

    expect(top).toEqual([
      { memberId: "m2", memberName: "DailyOnly", priorDayVsScore: 9_000_000 },
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
      {
        ashedMemberId: "m5",
        currentName: "Epsilon",
        allianceRank: 5,
      },
    ]);
  });

  it("excludes former / non-roster Ashed scorers and fills Top N from active R3–R5 members", async () => {
    mocks.base44Json.mockResolvedValue([
      { member_id: "m1", member_name: "Departed", score: 12_000_000 },
      { member_id: "m5", member_name: "Epsilon", score: 10_000_000 },
      { member_id: "m2", member_name: "StaleName", score: 9_000_000 },
      { member_id: "m3", member_name: "Gamma", score: 8_000_000 },
      { member_id: "m4", member_name: "AlsoGone", score: 7_500_000 },
    ]);

    const top = await fetchAllianceVsTopScorersForTrainDate("hq-1", "2026-07-09", 3);

    expect(mocks.listActiveAllianceMembersForPool).toHaveBeenCalledWith("hq-1");
    expect(top).toEqual([
      {
        memberId: "m5",
        memberName: "Epsilon",
        allianceRank: 5,
        priorDayVsScore: 10_000_000,
      },
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

  it("filters out R4/R5 before the Top N slice when the alliance disables them", async () => {
    mocks.loadTrainTopScoreEligibility.mockResolvedValue({
      trainTopScoreIncludesR4Plus: false,
      canManage: false,
    });
    mocks.listActiveAllianceMembersForPool.mockResolvedValue([
      { ashedMemberId: "m2", currentName: "Beta", allianceRank: 3 },
      { ashedMemberId: "m3", currentName: "Gamma", allianceRank: 4 },
      { ashedMemberId: "m4", currentName: "Delta", allianceRank: 3 },
    ]);
    mocks.base44Json.mockResolvedValue([
      { member_id: "m3", member_name: "Gamma", score: 12_000_000 },
      { member_id: "m2", member_name: "Beta", score: 9_000_000 },
      { member_id: "m4", member_name: "Delta", score: 8_000_000 },
    ]);

    const top = await fetchAllianceVsTopScorersForTrainDate(
      "hq-1",
      "2026-07-09",
      2,
    );

    expect(top).toEqual([
      {
        memberId: "m2",
        memberName: "Beta",
        allianceRank: 3,
        priorDayVsScore: 9_000_000,
      },
      {
        memberId: "m4",
        memberName: "Delta",
        allianceRank: 3,
        priorDayVsScore: 8_000_000,
      },
    ]);
  });

  it("never includes R1/R2 scorers even when R4+ is enabled", async () => {
    mocks.listActiveAllianceMembersForPool.mockResolvedValue([
      { ashedMemberId: "m1", currentName: "Low", allianceRank: 1 },
      { ashedMemberId: "m2", currentName: "Beta", allianceRank: 3 },
    ]);
    mocks.base44Json.mockResolvedValue([
      { member_id: "m1", member_name: "Low", score: 15_000_000 },
      { member_id: "m2", member_name: "Beta", score: 9_000_000 },
    ]);

    const top = await fetchAllianceVsTopScorersForTrainDate(
      "hq-1",
      "2026-07-09",
      2,
    );

    expect(top).toEqual([
      {
        memberId: "m2",
        memberName: "Beta",
        allianceRank: 3,
        priorDayVsScore: 9_000_000,
      },
    ]);
  });

  it("uses the HQ rank event over a stale synced roster rank", async () => {
    mocks.loadTrainTopScoreEligibility.mockResolvedValue({
      trainTopScoreIncludesR4Plus: false,
      canManage: false,
    });
    mocks.listActiveAllianceMembersForPool.mockResolvedValue([
      { ashedMemberId: "m2", currentName: "Beta", allianceRank: 4 },
      { ashedMemberId: "m3", currentName: "Gamma", allianceRank: 3 },
    ]);
    mocks.getAllianceRanksAsOf.mockResolvedValue([
      {
        id: "evt-1",
        allianceId: "hq-1",
        ashedMemberId: "m2",
        memberName: "Beta",
        allianceRank: 3,
        allianceRankTitle: null,
        effectiveDate: "2026-07-01",
        recordedAt: new Date("2026-07-01T12:00:00Z"),
        source: "manual",
        recordedByHqUserId: null,
        ashedSyncedAt: null,
      },
    ]);
    mocks.base44Json.mockResolvedValue([
      { member_id: "m2", member_name: "Beta", score: 9_000_000 },
      { member_id: "m3", member_name: "Gamma", score: 8_000_000 },
    ]);

    const top = await fetchAllianceVsTopScorersForTrainDate(
      "hq-1",
      "2026-07-09",
      2,
    );

    expect(mocks.getAllianceRanksAsOf).toHaveBeenCalledWith(
      "hq-1",
      "2026-07-09",
    );
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
        allianceRank: 3,
        priorDayVsScore: 8_000_000,
      },
    ]);
  });
});

describe("fetchAllianceVsScoresForEvaluationPeriod", () => {
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
  });

  it("uses a single recorded_date for daily windows", async () => {
    mocks.base44Json.mockResolvedValue([
      { member_id: "m1", score: 7_500_000 },
      { member_id: "m2", score: 6_000_000 },
    ]);

    const scores = await fetchAllianceVsScoresForEvaluationPeriod(
      "hq-1",
      "2026-08-09",
      "2026-08-09",
    );

    expect(scores.get("m1")).toBe(7_500_000);
    expect(mocks.base44Json).toHaveBeenCalledTimes(1);
  });

  it("sums daily VS across multi-day evaluation windows", async () => {
    mocks.base44Json
      .mockResolvedValueOnce([{ member_id: "m1", score: 4_000_000 }])
      .mockResolvedValueOnce([{ member_id: "m1", score: 3_500_000 }]);

    const scores = await fetchAllianceVsScoresForEvaluationPeriod(
      "hq-1",
      "2026-08-04",
      "2026-08-05",
    );

    expect(scores.get("m1")).toBe(7_500_000);
    expect(mocks.base44Json).toHaveBeenCalledTimes(2);
  });
});

describe("fetchAllianceVsDay1To5CoverageForDay6", () => {
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
  });

  it("sums Mon–Fri daily scores and counts covered days per member", async () => {
    mocks.base44Json.mockImplementation((_conn, path: string) => {
      if (path.includes("2026-08-03")) {
        return Promise.resolve([{ member_id: "m1", score: 10_000_000 }]);
      }
      if (path.includes("2026-08-04")) {
        return Promise.resolve([{ member_id: "m1", score: 20_000_000 }]);
      }
      if (path.includes("2026-08-05")) {
        return Promise.resolve([{ member_id: "m1", score: 30_000_000 }]);
      }
      if (path.includes("2026-08-06")) {
        return Promise.resolve([{ member_id: "m1", score: 40_000_000 }]);
      }
      if (path.includes("2026-08-07")) {
        return Promise.resolve([{ member_id: "m1", score: 50_000_000 }]);
      }
      return Promise.resolve([]);
    });

    const coverage = await fetchAllianceVsDay1To5CoverageForDay6(
      "hq-1",
      "2026-08-08",
    );

    expect(coverage.get("m1")).toEqual({
      total: 150_000_000,
      daysCovered: 5,
    });
    expect(mocks.base44Json).toHaveBeenCalledTimes(5);
  });

  it("reports partial coverage when a member is missing days", async () => {
    mocks.base44Json.mockImplementation((_conn, path: string) => {
      if (path.includes("2026-08-03")) {
        return Promise.resolve([{ member_id: "m1", score: 10_000_000 }]);
      }
      if (path.includes("2026-08-04")) {
        return Promise.resolve([{ member_id: "m1", score: 20_000_000 }]);
      }
      if (path.includes("2026-08-05")) {
        return Promise.resolve([]);
      }
      if (path.includes("2026-08-06")) {
        return Promise.resolve([{ member_id: "m1", score: 40_000_000 }]);
      }
      if (path.includes("2026-08-07")) {
        return Promise.resolve([{ member_id: "m1", score: 50_000_000 }]);
      }
      return Promise.resolve([]);
    });

    const coverage = await fetchAllianceVsDay1To5CoverageForDay6(
      "hq-1",
      "2026-08-08",
    );

    expect(coverage.get("m1")).toEqual({
      total: 120_000_000,
      daysCovered: 4,
    });
  });

  it("excludes weekly rows from day coverage totals", async () => {
    mocks.base44Json.mockImplementation((_conn, path: string) => {
      if (path.includes("2026-08-03")) {
        return Promise.resolve([
          { member_id: "m1", score: 99_000_000, is_weekly: true },
          { member_id: "m1", score: 10_000_000, is_weekly: false },
        ]);
      }
      if (
        path.includes("2026-08-04") ||
        path.includes("2026-08-05") ||
        path.includes("2026-08-06") ||
        path.includes("2026-08-07")
      ) {
        return Promise.resolve([{ member_id: "m1", score: 10_000_000 }]);
      }
      return Promise.resolve([]);
    });

    const coverage = await fetchAllianceVsDay1To5CoverageForDay6(
      "hq-1",
      "2026-08-08",
    );

    expect(coverage.get("m1")).toEqual({
      total: 50_000_000,
      daysCovered: 5,
    });
  });
});
