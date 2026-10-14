import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  postDiscord: vi.fn(),
  updateWhereReturning: vi.fn(),
  updateWhere: vi.fn(),
  updateSet: vi.fn(),
  selectLimit: vi.fn(),
  selectWhere: vi.fn(),
  selectFrom: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: mocks.select,
    update: () => ({
      set: mocks.updateSet,
    }),
  }),
  schema: {
    battlePlanSettings: {
      allianceId: "allianceId",
      discordReportsEnabled: "discordReportsEnabled",
    },
    battlePlanCaptureEvents: {
      id: "id",
      allianceId: "allianceId",
      status: "status",
      territoryType: "territoryType",
      scheduledAt: "scheduledAt",
      discordAnnouncedAt: "discordAnnouncedAt",
      level: "level",
      iconPreset: "iconPreset",
      coordX: "coordX",
      coordY: "coordY",
    },
    banks: {
      id: "id",
      allianceId: "allianceId",
      protectionExpiresAt: "protectionExpiresAt",
      discordProtectionLastMilestone: "discordProtectionLastMilestone",
      level: "level",
      coordX: "coordX",
      coordY: "coordY",
    },
    discordGuildAlliances: {
      guildId: "guildId",
      allianceId: "allianceId",
      seasonalEventsChannelId: "seasonalEventsChannelId",
      bankingChannelId: "bankingChannelId",
    },
  },
}));

vi.mock("@/lib/discord/post-message.server", () => ({
  postDiscordChannelMessage: (...args: unknown[]) => mocks.postDiscord(...args),
}));

import { processPreCaptureAnnouncements } from "./discord-announcements.server";

describe("processPreCaptureAnnouncements claim-before-post", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateSet.mockImplementation(() => ({
      where: (condition: unknown) => {
        // First update is the claim (with returning); clear uses plain where.
        if (mocks.updateWhereReturning.mock.calls.length === 0) {
          return {
            returning: () => mocks.updateWhereReturning(condition),
          };
        }
        return mocks.updateWhere(condition);
      },
    }));
    mocks.updateWhereReturning.mockResolvedValue([{ id: "evt-1" }]);
    mocks.updateWhere.mockResolvedValue([]);

    // Channel lookup → settings → events
    let selectCall = 0;
    mocks.select.mockImplementation(() => {
      selectCall += 1;
      return { from: mocks.selectFrom };
    });
    mocks.selectFrom.mockImplementation(() => ({
      where: (...args: unknown[]) => {
        // First select: guild channels; second: settings; third: events
        if (selectCall === 1) {
          return Promise.resolve([
            {
              guildId: "g1",
              allianceId: "alliance-1",
              channelId: "channel-1",
            },
          ]);
        }
        if (selectCall === 2) {
          return {
            limit: () => mocks.selectLimit(...args),
          };
        }
        return mocks.selectWhere(...args);
      },
    }));
    mocks.selectLimit.mockResolvedValue([{ enabled: 1 }]);
    mocks.selectWhere.mockResolvedValue([
      {
        id: "evt-1",
        allianceId: "alliance-1",
        status: "scheduled",
        territoryType: "stronghold",
        scheduledAt: new Date(Date.now() + 30 * 60 * 1000),
        discordAnnouncedAt: null,
        level: 5,
        iconPreset: "A",
        coordX: 100,
        coordY: 200,
      },
    ]);
  });

  it("clears discordAnnouncedAt when every Discord post fails", async () => {
    mocks.postDiscord.mockResolvedValue(false);

    const result = await processPreCaptureAnnouncements();

    expect(result).toEqual({ posted: 0, skipped: 1 });
    expect(mocks.updateWhere).toHaveBeenCalled();
  });

  it("clears discordAnnouncedAt when Discord delivery throws after claim", async () => {
    mocks.postDiscord.mockRejectedValueOnce(new Error("discord boom"));

    const result = await processPreCaptureAnnouncements();

    expect(result.posted).toBe(0);
    expect(mocks.updateWhere).toHaveBeenCalled();
  });

  it("keeps the claim when at least one Discord post succeeds", async () => {
    mocks.postDiscord.mockResolvedValue(true);

    const result = await processPreCaptureAnnouncements();

    expect(result).toEqual({ posted: 1, skipped: 0 });
    expect(mocks.updateWhere).not.toHaveBeenCalled();
  });
});
