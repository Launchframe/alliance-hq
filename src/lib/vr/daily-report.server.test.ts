import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listRegisteredGuildsWithReportChannel,
  resolveAllianceForGuild,
  loadAllianceLeaderboard,
  postDiscordChannelMessage,
  getServerCalendarDate,
  insertValues,
  onConflictDoNothing,
  returning,
  deleteWhere,
} = vi.hoisted(() => ({
  listRegisteredGuildsWithReportChannel: vi.fn(),
  resolveAllianceForGuild: vi.fn(),
  loadAllianceLeaderboard: vi.fn(),
  postDiscordChannelMessage: vi.fn(),
  getServerCalendarDate: vi.fn(() => "2026-10-11"),
  insertValues: vi.fn(),
  onConflictDoNothing: vi.fn(),
  returning: vi.fn(),
  deleteWhere: vi.fn(),
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
  postDiscordChannelMessage,
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
    postDiscordChannelMessage.mockResolvedValue(true);
    returning.mockResolvedValue([{ id: "claim-1" }]);
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
      }),
    );
    expect(postDiscordChannelMessage).toHaveBeenCalledWith(
      "c1",
      "leaderboard message",
    );
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it("skips when the idempotency claim is already taken", async () => {
    returning.mockResolvedValueOnce([]);

    await expect(processVrDailyReports()).resolves.toEqual({
      posted: 0,
      skipped: 1,
      configured: 1,
    });
    expect(loadAllianceLeaderboard).not.toHaveBeenCalled();
    expect(postDiscordChannelMessage).not.toHaveBeenCalled();
  });

  it("clears the claim when Discord delivery returns false", async () => {
    postDiscordChannelMessage.mockResolvedValueOnce(false);

    await expect(processVrDailyReports()).resolves.toEqual({
      posted: 0,
      skipped: 1,
      configured: 1,
    });
    expect(deleteWhere).toHaveBeenCalled();
  });

  it("clears the claim when leaderboard load throws", async () => {
    loadAllianceLeaderboard.mockRejectedValueOnce(new Error("db down"));

    await expect(processVrDailyReports()).resolves.toEqual({
      posted: 0,
      skipped: 1,
      configured: 1,
    });
    expect(deleteWhere).toHaveBeenCalled();
    expect(postDiscordChannelMessage).not.toHaveBeenCalled();
  });
});
