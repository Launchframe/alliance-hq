import { beforeEach, describe, expect, it, vi } from "vitest";

const selectLimit = vi.hoisted(() => vi.fn());

vi.mock("@/lib/game-season/sync", () => ({
  getEffectiveSeasonForAlliance: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: selectLimit,
          }),
        }),
      }),
    }),
  }),
  schema: {
    alliances: {
      id: "id",
      currentSeasonKey: "currentSeasonKey",
      gameServerNumber: "gameServerNumber",
      gameServerOpenTimestamp: "gameServerOpenTimestamp",
      seasonKeyOverride: "seasonKeyOverride",
      seasonKeySynced: "seasonKeySynced",
      seasonKeySource: "seasonKeySource",
      seasonSyncedAt: "seasonSyncedAt",
      seasonIsPostSeason: "seasonIsPostSeason",
      seasonWeek: "seasonWeek",
    },
    commanderAllianceMemberships: {
      commanderId: "commanderId",
      allianceId: "allianceId",
      ashedMemberId: "ashedMemberId",
    },
    commanders: { id: "id", weeklyPassActive: "weeklyPassActive" },
  },
}));

import { upsertMemberSeasonVr } from "@/lib/vr/repository";

describe("upsertMemberSeasonVr", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectLimit.mockResolvedValue([]);
  });

  it("throws commander_required_for_vr when commander cannot be resolved", async () => {
    await expect(
      upsertMemberSeasonVr({
        allianceId: "alliance-1",
        ashedMemberId: "member-1",
        seasonKey: "1",
        baseVr: 100,
        hqUserId: "hq-1",
        eventSource: "web",
      }),
    ).rejects.toThrow("commander_required_for_vr");
  });
});
