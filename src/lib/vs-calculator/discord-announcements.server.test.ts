import { beforeEach, describe, expect, it, vi } from "vitest";

import * as dbModule from "@/lib/db";

vi.mock("@/lib/discord/post-message.server", () => ({
  postDiscordChannelMessage: vi.fn(),
}));

vi.mock("@/lib/vs-calculator/announcement-build.server", () => ({
  buildVsDailyAnnouncementPreview: vi.fn(),
}));

vi.mock("@/lib/vs-calculator/announcement-locale.server", () => ({
  resolveVsAnnouncementLocaleForAlliance: vi.fn(),
}));

vi.mock("@/lib/vs-calculator/inventory.server", () => ({
  listActiveVsCatalogDefs: vi.fn(),
}));

import { postDiscordChannelMessage } from "@/lib/discord/post-message.server";
import {
  listGuildsWithVsAnnouncementsChannel,
  processVsDailyAnnouncements,
} from "@/lib/vs-calculator/discord-announcements.server";
import { buildVsDailyAnnouncementPreview } from "@/lib/vs-calculator/announcement-build.server";
import { resolveVsAnnouncementLocaleForAlliance } from "@/lib/vs-calculator/announcement-locale.server";
import { listActiveVsCatalogDefs } from "@/lib/vs-calculator/inventory.server";

type ChannelRow = {
  guildId: string;
  allianceId: string;
  channelId: string | null;
};

/** Builds a getDb() mock covering the select (channel lookup) and insert (claim) chains used here. */
function mockDb(input: {
  channelRows: ChannelRow[];
  /** One entry per expected insert().values()...returning() call, in call order. */
  claimResults: Array<Array<{ id: string }>>;
}) {
  let claimCallIndex = 0;
  const returningMock = vi.fn().mockImplementation(() => {
    const result = input.claimResults[claimCallIndex] ?? [];
    claimCallIndex += 1;
    return Promise.resolve(result);
  });

  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(input.channelRows),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockReturnValue({
          returning: returningMock,
        }),
      }),
    }),
  };
}

describe("listGuildsWithVsAnnouncementsChannel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("drops rows with a blank or null channel id (opt-in/channel gating)", async () => {
    vi.spyOn(dbModule, "getDb").mockReturnValue(
      mockDb({
        channelRows: [
          { guildId: "g1", allianceId: "a1", channelId: "c1" },
          { guildId: "g2", allianceId: "a2", channelId: "  " },
          { guildId: "g3", allianceId: "a3", channelId: null },
        ],
        claimResults: [],
      }) as never,
    );

    const targets = await listGuildsWithVsAnnouncementsChannel();
    expect(targets).toEqual([{ guildId: "g1", allianceId: "a1", channelId: "c1" }]);
  });
});

describe("processVsDailyAnnouncements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listActiveVsCatalogDefs).mockResolvedValue([]);
    vi.mocked(resolveVsAnnouncementLocaleForAlliance).mockResolvedValue("en-US");
    vi.mocked(buildVsDailyAnnouncementPreview).mockResolvedValue({
      targetDate: "2024-01-08",
      message: "preview message",
    });
    vi.mocked(postDiscordChannelMessage).mockResolvedValue(true);
  });

  it("returns zero counts when no alliance has an announcements channel", async () => {
    vi.spyOn(dbModule, "getDb").mockReturnValue(
      mockDb({ channelRows: [], claimResults: [] }) as never,
    );

    await expect(processVsDailyAnnouncements()).resolves.toEqual({
      posted: 0,
      skipped: 0,
    });
    expect(buildVsDailyAnnouncementPreview).not.toHaveBeenCalled();
  });

  it("claims idempotency once per alliance and posts to every configured channel", async () => {
    vi.spyOn(dbModule, "getDb").mockReturnValue(
      mockDb({
        channelRows: [
          { guildId: "g1", allianceId: "a1", channelId: "c1" },
          { guildId: "g2", allianceId: "a1", channelId: "c2" },
        ],
        claimResults: [[{ id: "claim-1" }]],
      }) as never,
    );

    const result = await processVsDailyAnnouncements();

    expect(result).toEqual({ posted: 2, skipped: 0 });
    expect(postDiscordChannelMessage).toHaveBeenCalledWith("c1", "preview message");
    expect(postDiscordChannelMessage).toHaveBeenCalledWith("c2", "preview message");
    // Message is built once per alliance and shared across its channels.
    expect(buildVsDailyAnnouncementPreview).toHaveBeenCalledTimes(1);
  });

  it("skips a second run for the same alliance+date (idempotency claim already taken)", async () => {
    vi.spyOn(dbModule, "getDb").mockReturnValue(
      mockDb({
        channelRows: [{ guildId: "g1", allianceId: "a1", channelId: "c1" }],
        claimResults: [[]], // onConflictDoNothing found an existing row -> empty returning
      }) as never,
    );

    const result = await processVsDailyAnnouncements();

    expect(result).toEqual({ posted: 0, skipped: 1 });
    expect(buildVsDailyAnnouncementPreview).not.toHaveBeenCalled();
    expect(postDiscordChannelMessage).not.toHaveBeenCalled();
  });

  it("resolves locale per alliance and passes it into the message builder", async () => {
    vi.mocked(resolveVsAnnouncementLocaleForAlliance).mockResolvedValue("pt-BR");
    vi.spyOn(dbModule, "getDb").mockReturnValue(
      mockDb({
        channelRows: [{ guildId: "g1", allianceId: "a1", channelId: "c1" }],
        claimResults: [[{ id: "claim-1" }]],
      }) as never,
    );

    await processVsDailyAnnouncements();

    expect(resolveVsAnnouncementLocaleForAlliance).toHaveBeenCalledWith("a1");
    expect(buildVsDailyAnnouncementPreview).toHaveBeenCalledWith(
      expect.objectContaining({ allianceId: "a1", locale: "pt-BR" }),
    );
  });

  it("counts a failed Discord post as skipped, not posted", async () => {
    vi.mocked(postDiscordChannelMessage).mockResolvedValueOnce(false);
    vi.spyOn(dbModule, "getDb").mockReturnValue(
      mockDb({
        channelRows: [{ guildId: "g1", allianceId: "a1", channelId: "c1" }],
        claimResults: [[{ id: "claim-1" }]],
      }) as never,
    );

    const result = await processVsDailyAnnouncements();
    expect(result).toEqual({ posted: 0, skipped: 1 });
  });

  it("processes multiple alliances independently (one claimed, one already posted)", async () => {
    vi.spyOn(dbModule, "getDb").mockReturnValue(
      mockDb({
        channelRows: [
          { guildId: "g1", allianceId: "a1", channelId: "c1" },
          { guildId: "g2", allianceId: "a2", channelId: "c2" },
        ],
        claimResults: [[{ id: "claim-1" }], []],
      }) as never,
    );

    const result = await processVsDailyAnnouncements();
    expect(result).toEqual({ posted: 1, skipped: 1 });
  });
});
