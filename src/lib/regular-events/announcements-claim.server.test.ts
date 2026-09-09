import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimAnnounced: vi.fn(),
  clearAnnounced: vi.fn(),
  markAnnounced: vi.fn(),
  listDue: vi.fn(),
  listEnabled: vi.fn(),
  postDiscord: vi.fn(),
  materializeInbox: vi.fn(),
  dbSelect: vi.fn(),
  dbFrom: vi.fn(),
  dbWhere: vi.fn(),
}));

vi.mock("@/lib/discord/i18n", () => ({
  createDiscordTranslator: () => (key: string) => key,
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: mocks.dbSelect,
  }),
  schema: {
    alliances: { id: "id", currentSeasonKey: "currentSeasonKey", gameServerNumber: "gameServerNumber" },
    discordGuildAlliances: {
      guildId: "guildId",
      allianceId: "allianceId",
      regularEventsChannelId: "regularEventsChannelId",
      r4ChannelId: "r4ChannelId",
    },
  },
}));

vi.mock("@/lib/regular-events/repository.server", () => ({
  getLastOccurrenceForRule: vi.fn(),
  insertRegularEventOccurrence: vi.fn(),
  listActiveRegularEventScheduleRules: vi.fn(),
  listAllianceIdsWithActiveRegularEventRules: vi.fn(),
  listAlliancesWithRegularEventsAnnouncementsEnabled: (...args: unknown[]) => mocks.listEnabled(...args),
  listDueRegularEventOccurrences: (...args: unknown[]) => mocks.listDue(...args),
  listDueRegularEventScheduleReminders: vi.fn(),
  listDueRegularEventUploadReminders: vi.fn(),
  claimRegularEventOccurrenceAnnounced: (...args: unknown[]) => mocks.claimAnnounced(...args),
  claimRegularEventOccurrenceScheduleReminded: vi.fn(),
  clearRegularEventOccurrenceAnnounced: (...args: unknown[]) => mocks.clearAnnounced(...args),
  clearRegularEventOccurrenceScheduleReminded: vi.fn(),
  markRegularEventOccurrenceAnnounced: (...args: unknown[]) => mocks.markAnnounced(...args),
  markRegularEventOccurrenceScheduleReminded: vi.fn(),
  markRegularEventOccurrenceUploadReminded: vi.fn(),
}));

vi.mock("@/lib/regular-events/inbox.server", () => ({
  materializeRegularEventReminderInboxItem: (...args: unknown[]) => mocks.materializeInbox(...args),
  materializeRegularEventUploadReminderInboxItem: vi.fn(),
}));

vi.mock("@/lib/discord/post-message.server", () => ({
  postDiscordChannelMessage: (...args: unknown[]) => mocks.postDiscord(...args),
}));

import { processDueRegularEventAnnouncements } from "./announcements.server";

const dueOccurrence = {
  id: "occ-1",
  allianceId: "alliance-1",
  eventKey: "zombie_siege",
  scheduledStartAt: new Date("2026-06-23T21:30:00.000Z"),
  announceAt: new Date("2026-06-23T20:30:00.000Z"),
};

describe("processDueRegularEventAnnouncements claim-before-post", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listEnabled.mockResolvedValue(["alliance-1"]);
    mocks.listDue.mockResolvedValue([dueOccurrence]);
    mocks.claimAnnounced.mockResolvedValue(true);
    mocks.materializeInbox.mockResolvedValue(undefined);
    mocks.dbSelect.mockReturnValue({ from: mocks.dbFrom });
    mocks.dbFrom.mockReturnValue({ where: mocks.dbWhere });
    mocks.dbWhere.mockResolvedValue([
      {
        guildId: "g1",
        allianceId: "alliance-1",
        channelId: "channel-1",
      },
    ]);
  });

  it("clears the claim when every Discord post fails so the next cron can retry", async () => {
    mocks.postDiscord.mockResolvedValue(false);

    const result = await processDueRegularEventAnnouncements(new Date("2026-06-23T20:35:00.000Z"));

    expect(mocks.claimAnnounced).toHaveBeenCalledWith("occ-1", expect.any(Date));
    expect(mocks.postDiscord).toHaveBeenCalledWith(
      "channel-1",
      expect.any(String),
    );
    expect(mocks.clearAnnounced).toHaveBeenCalledWith("occ-1");
    expect(result.posted).toBe(0);
  });

  it("keeps the claim when at least one Discord post succeeds", async () => {
    mocks.postDiscord.mockResolvedValue(true);

    const result = await processDueRegularEventAnnouncements(new Date("2026-06-23T20:35:00.000Z"));

    expect(mocks.clearAnnounced).not.toHaveBeenCalled();
    expect(result.posted).toBe(1);
  });

  it("skips Discord work when another worker already claimed the occurrence", async () => {
    mocks.claimAnnounced.mockResolvedValue(false);

    const result = await processDueRegularEventAnnouncements(new Date("2026-06-23T20:35:00.000Z"));

    expect(mocks.postDiscord).not.toHaveBeenCalled();
    expect(mocks.clearAnnounced).not.toHaveBeenCalled();
    expect(result.posted).toBe(0);
    expect(result.skipped).toBe(1);
  });
});
