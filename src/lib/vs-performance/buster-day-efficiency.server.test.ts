import { beforeEach, describe, expect, it, vi } from "vitest";

const selectLimit = vi.hoisted(() => vi.fn());
const selectWhere = vi.hoisted(() => vi.fn());
const resolveHqAllianceIdFromStoredAllianceId = vi.hoisted(() => vi.fn());

function whereChain() {
  const chain = {
    limit: selectLimit,
    orderBy: () => selectWhere(),
    then: (
      resolve: (value: unknown) => void,
      reject?: (reason: unknown) => void,
    ) => selectWhere().then(resolve, reject),
  };
  return chain;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => whereChain(),
        innerJoin: () => ({
          leftJoin: () => ({
            where: () => whereChain(),
          }),
        }),
      }),
    }),
  }),
  schema: {
    videoJobs: {
      id: "id",
      parseSessionId: "parseSessionId",
      allianceId: "allianceId",
    },
    parsedRows: {
      memberId: "memberId",
      powerLevel: "powerLevel",
      deleted: "deleted",
      parseSessionId: "parseSessionId",
    },
    commanderAllianceMemberships: {
      commanderId: "commanderId",
      ashedMemberId: "ashedMemberId",
      rosterNameAtMembership: "rosterNameAtMembership",
      allianceId: "allianceId",
      leftAt: "leftAt",
    },
    commanders: { id: "id", primaryName: "primaryName" },
    allianceMembers: {
      allianceId: "allianceId",
      ashedMemberId: "ashedMemberId",
      currentName: "currentName",
    },
    commanderPowerLevelEvents: {
      commanderId: "commanderId",
      allianceId: "allianceId",
      recordedDate: "recordedDate",
      value: "value",
    },
    commanderKillsEvents: {
      commanderId: "commanderId",
      total: "total",
      createdAt: "createdAt",
      discardedAt: "discardedAt",
    },
  },
}));

vi.mock("@/lib/video/video-job-alliance.server", () => ({
  resolveHqAllianceIdFromStoredAllianceId: (
    ...args: unknown[]
  ) => resolveHqAllianceIdFromStoredAllianceId(...args),
}));

vi.mock("@/lib/trains/vs-scores.server", () => ({
  fetchAlliancePriorDayVsScoresByMember: vi.fn().mockResolvedValue(new Map()),
}));

import { loadPowerByAshedMemberFromRosterJob } from "./buster-day-efficiency.server";

describe("loadPowerByAshedMemberFromRosterJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty for blank job ids", async () => {
    await expect(
      loadPowerByAshedMemberFromRosterJob("hq-a1", "  "),
    ).resolves.toEqual(new Map());
    expect(selectLimit).not.toHaveBeenCalled();
  });

  it("returns empty when the job has no parse session", async () => {
    selectLimit.mockResolvedValueOnce([{ parseSessionId: null, allianceId: "hq-a1" }]);

    await expect(
      loadPowerByAshedMemberFromRosterJob("hq-a1", "job-1"),
    ).resolves.toEqual(new Map());
    expect(selectWhere).not.toHaveBeenCalled();
  });

  it("returns empty when the stored job alliance does not match the report tenant", async () => {
    selectLimit.mockResolvedValueOnce([
      { parseSessionId: "ps-1", allianceId: "other-alliance" },
    ]);
    resolveHqAllianceIdFromStoredAllianceId.mockResolvedValueOnce("other-hq");

    await expect(
      loadPowerByAshedMemberFromRosterJob("hq-a1", "job-1"),
    ).resolves.toEqual(new Map());
    expect(selectWhere).not.toHaveBeenCalled();
  });

  it("loads OCR powers when the job belongs to the alliance", async () => {
    selectLimit.mockResolvedValueOnce([
      { parseSessionId: "ps-1", allianceId: "hq-a1" },
    ]);
    resolveHqAllianceIdFromStoredAllianceId.mockResolvedValueOnce("hq-a1");
    selectWhere.mockResolvedValueOnce([
      { memberId: "m1", powerLevel: "200M", deleted: 0 },
      { memberId: "m2", powerLevel: "180M", deleted: 0 },
    ]);

    await expect(
      loadPowerByAshedMemberFromRosterJob("hq-a1", "job-1"),
    ).resolves.toEqual(
      new Map([
        ["m1", 200],
        ["m2", 180],
      ]),
    );
  });
});
