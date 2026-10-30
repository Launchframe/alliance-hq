import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listRegisteredGuildsWithReportChannel,
  resolveAllianceForGuild,
  loadAllianceLeaderboard,
  postDiscordChannelMessageResult,
  getServerCalendarDate,
  insertValues,
  onConflictDoNothing,
  returning,
  deleteWhere,
  updateSet,
  updateWhere,
  updateReturning,
} = vi.hoisted(() => ({
  listRegisteredGuildsWithReportChannel: vi.fn(),
  resolveAllianceForGuild: vi.fn(),
  loadAllianceLeaderboard: vi.fn(),
  postDiscordChannelMessageResult: vi.fn(),
  getServerCalendarDate: vi.fn(() => "2026-10-11"),
  insertValues: vi.fn(),
  onConflictDoNothing: vi.fn(),
  returning: vi.fn(),
  deleteWhere: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  updateReturning: vi.fn(),
}));

vi.mock("@/lib/vr/repository", () => ({
  listRegisteredGuildsWithReportChannel,
  resolveAllianceForGuild,
}));

vi.mock("@/lib/vr/leaderboard.server", () => ({
  loadAllianceLeaderboard,
}));

vi.mock("@/lib/vr/leaderboard", () => ({
  formatVrLeaderboard: vi.fn(() => "leaderboard message"),
}));

vi.mock("@/lib/discord/post-message.server", () => ({
  postDiscordChannelMessageResult,
}));

vi.mock("@/lib/trains/game-time", () => ({
  getServerCalendarDate,
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: () => ({
      insert: () => ({
        values: (...args: unknown[]) => {
          insertValues(...args);
          return {
            onConflictDoNothing: (...conflictArgs: unknown[]) => {
              onConflictDoNothing(...conflictArgs);
              return { returning };
            },
          };
        },
      }),
      update: () => ({
        set: (...args: unknown[]) => {
          updateSet(...args);
          return {
            where: (...whereArgs: unknown[]) => {
              updateWhere(...whereArgs);
              return { returning: updateReturning };
            },
          };
        },
      }),
      delete: () => ({
        where: (...args: unknown[]) => {
          deleteWhere(...args);
          return Promise.resolve();
        },
      }),
    }),
  };
});

import { processVrDailyReports } from "@/lib/vr/daily-report.server";

describe("processVrDailyReports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerCalendarDate.mockReturnValue("2026-10-11");
    listRegisteredGuildsWithReportChannel.mockResolvedValue([
      { guildId: "g1", allianceId: "a1", channelId: "c1" },
    ]);
    loadAllianceLeaderboard.mockResolvedValue({
      seasonKey: "S1",
      allianceTag: "TAG",
      rows: [],
    });
    postDiscordChannelMessageResult.mockResolvedValue({ ok: true });
    returning.mockResolvedValue([{ id: "claim-1" }]);
    updateReturning.mockResolvedValue([]);
  });

  it("claims once per guild+date then posts", async () => {
    await expect(processVrDailyReports()).resolves.toEqual({
      posted: 1,
      skipped: 0,
      configured: 1,
    });
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: "g1",
        allianceId: "a1",
        reportDate: "2026-10-11",
        status: "in_flight",
      }),
    );
    expect(postDiscordChannelMessageResult).toHaveBeenCalledWith(
      "c1",
      "leaderboard message",
      { source: "vr.daily_report" },
    );
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "posted" }),
    );
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it("skips when the idempotency claim is already posted", async () => {
    returning.mockResolvedValueOnce([]);
    updateReturning.mockResolvedValueOnce([]);

    await expect(processVrDailyReports()).resolves.toEqual({
      posted: 0,
      skipped: 1,
      configured: 1,
    });
    expect(loadAllianceLeaderboard).not.toHaveBeenCalled();
    expect(postDiscordChannelMessageResult).not.toHaveBeenCalled();
  });

  it("reclaims an expired in_flight claim", async () => {
    returning.mockResolvedValueOnce([]);
    updateReturning.mockResolvedValueOnce([{ id: "reclaimed-1" }]);

    await expect(processVrDailyReports()).resolves.toEqual({
      posted: 1,
      skipped: 0,
      configured: 1,
    });
    expect(postDiscordChannelMessageResult).toHaveBeenCalled();
  });

  it("clears the claim when Discord delivery is a definite failure", async () => {
    postDiscordChannelMessageResult.mockResolvedValueOnce({
      ok: false,
      retryMayDuplicate: false,
    });

    await expect(processVrDailyReports()).resolves.toEqual({
      posted: 0,
      skipped: 1,
      configured: 1,
    });
    expect(deleteWhere).toHaveBeenCalled();
  });

  it("keeps the claim when Discord delivery may have succeeded", async () => {
    postDiscordChannelMessageResult.mockResolvedValueOnce({
      ok: false,
      retryMayDuplicate: true,
    });

    await expect(processVrDailyReports()).resolves.toEqual({
      posted: 1,
      skipped: 0,
      configured: 1,
    });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "posted" }),
    );
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it("clears the claim when leaderboard load throws", async () => {
    loadAllianceLeaderboard.mockRejectedValueOnce(new Error("db down"));

    await expect(processVrDailyReports()).resolves.toEqual({
      posted: 0,
      skipped: 1,
      configured: 1,
    });
    expect(deleteWhere).toHaveBeenCalled();
    expect(postDiscordChannelMessageResult).not.toHaveBeenCalled();
  });

  it("claims for the legacy env guild without a guild-registry FK", async () => {
    listRegisteredGuildsWithReportChannel.mockResolvedValueOnce([]);
    resolveAllianceForGuild.mockResolvedValueOnce("legacy-alliance");
    const previousChannel = process.env.DISCORD_VR_REPORT_CHANNEL_ID;
    const previousGuild = process.env.DISCORD_GUILD_ID;
    process.env.DISCORD_VR_REPORT_CHANNEL_ID = "legacy-channel";
    process.env.DISCORD_GUILD_ID = "legacy-guild";

    try {
      await expect(processVrDailyReports()).resolves.toEqual({
        posted: 1,
        skipped: 0,
        configured: 1,
      });
      expect(insertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          guildId: "legacy-guild",
          allianceId: "legacy-alliance",
        }),
      );
    } finally {
      if (previousChannel === undefined) {
        delete process.env.DISCORD_VR_REPORT_CHANNEL_ID;
      } else {
        process.env.DISCORD_VR_REPORT_CHANNEL_ID = previousChannel;
      }
      if (previousGuild === undefined) {
        delete process.env.DISCORD_GUILD_ID;
      } else {
        process.env.DISCORD_GUILD_ID = previousGuild;
      }
    }
  });
});
