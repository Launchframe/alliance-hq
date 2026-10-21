import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerCalendarDate: vi.fn(),
  listRegisteredGuildsWithTrainChannel: vi.fn(),
  getAllianceTrainDiscordAnnouncementsEnabled: vi.fn(),
  getEffectiveSeasonForAlliance: vi.fn(),
  getConductorRecord: vi.fn(),
  claimConductorDepartingSoonAnnounced: vi.fn(),
  clearConductorDepartingSoonAnnounced: vi.fn(),
  postDiscord: vi.fn(),
}));

vi.mock("@/lib/trains/service", () => ({
  getServerCalendarDate: (...args: unknown[]) => mocks.getServerCalendarDate(...args),
  refreshExhaustedPoolsForDay: vi.fn(),
}));

vi.mock("@/lib/vr/repository", () => ({
  getAllianceTrainDiscordAnnouncementsEnabled: (...args: unknown[]) =>
    mocks.getAllianceTrainDiscordAnnouncementsEnabled(...args),
  listGuildTrainChannelsForAlliance: vi.fn(),
  listRegisteredGuildsWithTrainChannel: (...args: unknown[]) =>
    mocks.listRegisteredGuildsWithTrainChannel(...args),
}));

vi.mock("@/lib/game-season/sync", () => ({
  getEffectiveSeasonForAlliance: (...args: unknown[]) =>
    mocks.getEffectiveSeasonForAlliance(...args),
}));

vi.mock("@/lib/trains/repository", () => ({
  getConductorRecord: (...args: unknown[]) => mocks.getConductorRecord(...args),
  claimConductorDepartingSoonAnnounced: (...args: unknown[]) =>
    mocks.claimConductorDepartingSoonAnnounced(...args),
  clearConductorDepartingSoonAnnounced: (...args: unknown[]) =>
    mocks.clearConductorDepartingSoonAnnounced(...args),
}));

vi.mock("@/lib/discord/post-message.server", () => ({
  postDiscordChannelMessage: (...args: unknown[]) => mocks.postDiscord(...args),
}));

import { processDepartingSoonReminders } from "./discord-bot.server";

const ALLIANCE_ID = "alliance-1";
const RECORD_ID = "record-1";
const TODAY = "2026-06-20";

describe("processDepartingSoonReminders claim-before-post", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // 3.5h after lock — inside departing-soon window (3h–4h) and still on_platform.
    vi.setSystemTime(new Date("2026-06-20T17:30:00.000Z"));

    mocks.getServerCalendarDate.mockReturnValue(TODAY);
    mocks.listRegisteredGuildsWithTrainChannel.mockResolvedValue([
      { guildId: "g1", allianceId: ALLIANCE_ID, channelId: "channel-1" },
    ]);
    mocks.getAllianceTrainDiscordAnnouncementsEnabled.mockResolvedValue(true);
    mocks.getEffectiveSeasonForAlliance.mockResolvedValue({ seasonKey: "1" });
    mocks.claimConductorDepartingSoonAnnounced.mockResolvedValue(true);

    const lockedAt = new Date("2026-06-20T14:00:00.000Z");
    mocks.getConductorRecord.mockResolvedValue({
      id: RECORD_ID,
      lockedAt,
      conductorMemberName: "Conductor One",
      discordDepartingSoonAt: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears the claim when every Discord post fails so the next cron can retry", async () => {
    mocks.postDiscord.mockResolvedValue(false);

    const result = await processDepartingSoonReminders();

    expect(mocks.claimConductorDepartingSoonAnnounced).toHaveBeenCalledWith(
      RECORD_ID,
      ALLIANCE_ID,
    );
    expect(mocks.postDiscord).toHaveBeenCalledWith(
      "channel-1",
      expect.any(String),
      { source: "train.departing_soon" },
    );
    expect(mocks.clearConductorDepartingSoonAnnounced).toHaveBeenCalledWith(
      RECORD_ID,
      ALLIANCE_ID,
    );
    expect(result.posted).toBe(0);
  });

  it("keeps the claim when at least one Discord post succeeds", async () => {
    mocks.postDiscord.mockResolvedValue(true);

    const result = await processDepartingSoonReminders();

    expect(mocks.clearConductorDepartingSoonAnnounced).not.toHaveBeenCalled();
    expect(result.posted).toBe(1);
  });

  it("clears the claim when Discord delivery throws after claim", async () => {
    mocks.postDiscord.mockRejectedValueOnce(new Error("discord boom"));

    const result = await processDepartingSoonReminders();

    expect(mocks.clearConductorDepartingSoonAnnounced).toHaveBeenCalledWith(
      RECORD_ID,
      ALLIANCE_ID,
    );
    expect(result.posted).toBe(0);
  });

  it("continues later alliances when one post-claim delivery throws", async () => {
    mocks.listRegisteredGuildsWithTrainChannel.mockResolvedValue([
      { guildId: "g1", allianceId: ALLIANCE_ID, channelId: "channel-1" },
      { guildId: "g2", allianceId: "alliance-2", channelId: "channel-2" },
    ]);
    const lockedAt = new Date("2026-06-20T14:00:00.000Z");
    mocks.getConductorRecord
      .mockResolvedValueOnce({
        id: RECORD_ID,
        lockedAt,
        conductorMemberName: "Conductor One",
        discordDepartingSoonAt: null,
      })
      .mockResolvedValueOnce({
        id: "record-2",
        lockedAt,
        conductorMemberName: "Conductor Two",
        discordDepartingSoonAt: null,
      });
    mocks.postDiscord
      .mockRejectedValueOnce(new Error("discord boom"))
      .mockResolvedValueOnce(true);

    const result = await processDepartingSoonReminders();

    expect(mocks.clearConductorDepartingSoonAnnounced).toHaveBeenCalledWith(
      RECORD_ID,
      ALLIANCE_ID,
    );
    expect(mocks.clearConductorDepartingSoonAnnounced).not.toHaveBeenCalledWith(
      "record-2",
      "alliance-2",
    );
    expect(result.posted).toBe(1);
  });
});
