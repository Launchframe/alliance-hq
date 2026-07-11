import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  postPriceIsRightLeaderboardToDiscord: vi.fn(),
  listRegisteredGuildsWithTrainChannel: vi.fn(),
}));

vi.mock("@/lib/trains/price-is-right-leaderboard-discord.server", () => ({
  postPriceIsRightLeaderboardToDiscord: mocks.postPriceIsRightLeaderboardToDiscord,
}));

vi.mock("@/lib/vr/repository", () => ({
  listRegisteredGuildsWithTrainChannel: mocks.listRegisteredGuildsWithTrainChannel,
}));

vi.mock("@/lib/trains/game-time", () => ({
  getServerCalendarDate: vi.fn().mockReturnValue("2026-07-09"),
}));

import { GET } from "./route";

describe("internal price-is-right leaderboard GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "cron-test-secret");
    mocks.listRegisteredGuildsWithTrainChannel.mockResolvedValue([
      { guildId: "g1", allianceId: "ally-1", channelId: "ch-1" },
      { guildId: "g2", allianceId: "ally-1", channelId: "ch-2" },
      { guildId: "g3", allianceId: "ally-2", channelId: "ch-3" },
    ]);
    mocks.postPriceIsRightLeaderboardToDiscord.mockResolvedValue({
      posted: 1,
      skipped: 0,
    });
  });

  it("403s without worker auth", async () => {
    const res = await GET(new Request("http://localhost/api/internal/train/price-is-right-leaderboard"));
    expect(res.status).toBe(403);
  });

  it("announces once per alliance when multiple guilds share an alliance", async () => {
    const res = await GET(
      new Request("http://localhost/api/internal/train/price-is-right-leaderboard", {
        headers: { authorization: "Bearer cron-test-secret" },
      }),
    );

    expect(res.status).toBe(200);
    expect(mocks.postPriceIsRightLeaderboardToDiscord).toHaveBeenCalledTimes(2);
    expect(mocks.postPriceIsRightLeaderboardToDiscord).toHaveBeenCalledWith({
      allianceId: "ally-1",
      trainDate: "2026-07-09",
    });
    expect(mocks.postPriceIsRightLeaderboardToDiscord).toHaveBeenCalledWith({
      allianceId: "ally-2",
      trainDate: "2026-07-09",
    });

    const body = await res.json();
    expect(body).toMatchObject({ ok: true, posted: 2, skipped: 0, date: "2026-07-09" });
  });
});
