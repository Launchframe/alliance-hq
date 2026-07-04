import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/lib/db";
import {
  ensureDiscordMemberLinksFromHq,
  inheritHqMemberLinkToDiscordIfLinked,
  inheritHqMemberLinksToDiscord,
} from "@/lib/member-link/inherit-hq-to-discord.server";
import {
  getDiscordHqLink,
  getDiscordHqLinkByHqUserId,
  linkDiscordMember,
} from "@/lib/vr/repository";

vi.mock("@/lib/db", () => ({
  getDb: vi.fn(),
  schema: {
    hqMemberLinks: {
      hqUserId: "hqUserId",
      allianceId: "allianceId",
      ashedMemberId: "ashedMemberId",
      memberDisplayName: "memberDisplayName",
      gameUid: "gameUid",
    },
  },
}));

vi.mock("@/lib/vr/repository", () => ({
  getDiscordHqLink: vi.fn(),
  getDiscordHqLinkByHqUserId: vi.fn(),
  linkDiscordMember: vi.fn(),
}));

describe("inheritHqMemberLinksToDiscord", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("no-ops when ids are blank", async () => {
    await expect(
      inheritHqMemberLinksToDiscord({
        discordUserId: " ",
        hqUserId: "hq-1",
      }),
    ).resolves.toEqual({ inherited: 0, skipped: 0 });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("creates Discord member links for each HQ commander", async () => {
    const where = vi.fn().mockResolvedValue([
      {
        allianceId: "alliance-1",
        ashedMemberId: "m-1",
        memberDisplayName: "Alpha",
        gameUid: "123456789012",
      },
      {
        allianceId: "alliance-1",
        ashedMemberId: "m-2",
        memberDisplayName: "Beta",
        gameUid: "123456789013",
      },
    ]);
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({ where }),
      }),
    } as never);
    vi.mocked(linkDiscordMember)
      .mockResolvedValueOnce({
        ok: true,
        mode: "created",
        link: { id: "d1" } as never,
      })
      .mockResolvedValueOnce({
        ok: true,
        mode: "created",
        link: { id: "d2" } as never,
      });

    await expect(
      inheritHqMemberLinksToDiscord({
        discordUserId: "discord-1",
        hqUserId: "hq-1",
      }),
    ).resolves.toEqual({ inherited: 2, skipped: 0 });

    expect(linkDiscordMember).toHaveBeenCalledTimes(2);
    expect(linkDiscordMember).toHaveBeenNthCalledWith(1, {
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      ashedMemberId: "m-1",
      memberDisplayName: "Alpha",
      gameUid: "123456789012",
    });
  });

  it("skips commanders already linked to another Discord user", async () => {
    const where = vi.fn().mockResolvedValue([
      {
        allianceId: "alliance-1",
        ashedMemberId: "m-1",
        memberDisplayName: "Alpha",
        gameUid: "123456789012",
      },
    ]);
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({ where }),
      }),
    } as never);
    vi.mocked(linkDiscordMember).mockResolvedValue({
      ok: false,
      reason: "member_linked_to_other_discord",
    });

    await expect(
      inheritHqMemberLinksToDiscord({
        discordUserId: "discord-1",
        hqUserId: "hq-1",
        allianceId: "alliance-1",
      }),
    ).resolves.toEqual({ inherited: 0, skipped: 1 });
  });

  it("does not count already-present Discord links as inherited", async () => {
    const where = vi.fn().mockResolvedValue([
      {
        allianceId: "alliance-1",
        ashedMemberId: "m-1",
        memberDisplayName: "Alpha",
        gameUid: "123456789012",
      },
    ]);
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({ where }),
      }),
    } as never);
    vi.mocked(linkDiscordMember).mockResolvedValue({
      ok: true,
      mode: "updated",
      link: { id: "d1" } as never,
    });

    await expect(
      inheritHqMemberLinksToDiscord({
        discordUserId: "discord-1",
        hqUserId: "hq-1",
      }),
    ).resolves.toEqual({ inherited: 0, skipped: 0 });
  });
});

describe("ensureDiscordMemberLinksFromHq", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("no-ops when Discord has no HQ account link", async () => {
    vi.mocked(getDiscordHqLink).mockResolvedValue(null);

    await expect(
      ensureDiscordMemberLinksFromHq({
        discordUserId: "discord-1",
        allianceId: "alliance-1",
      }),
    ).resolves.toEqual({ inherited: 0, skipped: 0 });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("inherits when HQ account link exists", async () => {
    vi.mocked(getDiscordHqLink).mockResolvedValue({
      discordUserId: "discord-1",
      hqUserId: "hq-1",
    } as never);
    const where = vi.fn().mockResolvedValue([
      {
        allianceId: "alliance-1",
        ashedMemberId: "m-1",
        memberDisplayName: "Alpha",
        gameUid: "123456789012",
      },
    ]);
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({ where }),
      }),
    } as never);
    vi.mocked(linkDiscordMember).mockResolvedValue({
      ok: true,
      mode: "created",
      link: { id: "d1" } as never,
    });

    await expect(
      ensureDiscordMemberLinksFromHq({
        discordUserId: "discord-1",
        allianceId: "alliance-1",
      }),
    ).resolves.toEqual({ inherited: 1, skipped: 0 });
  });
});

describe("inheritHqMemberLinkToDiscordIfLinked", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when HQ user has no Discord account link", async () => {
    vi.mocked(getDiscordHqLinkByHqUserId).mockResolvedValue(null);

    await expect(
      inheritHqMemberLinkToDiscordIfLinked({
        hqUserId: "hq-1",
        allianceId: "alliance-1",
        ashedMemberId: "m-1",
        gameUid: "123456789012",
      }),
    ).resolves.toBe(false);
    expect(linkDiscordMember).not.toHaveBeenCalled();
  });

  it("mirrors the web commander onto Discord when HQ is linked", async () => {
    vi.mocked(getDiscordHqLinkByHqUserId).mockResolvedValue({
      discordUserId: "discord-1",
      hqUserId: "hq-1",
    } as never);
    vi.mocked(linkDiscordMember).mockResolvedValue({
      ok: true,
      mode: "created",
      link: { id: "d1" } as never,
    });

    await expect(
      inheritHqMemberLinkToDiscordIfLinked({
        hqUserId: "hq-1",
        allianceId: "alliance-1",
        ashedMemberId: "m-1",
        memberDisplayName: "Alpha",
        gameUid: "123456789012",
      }),
    ).resolves.toBe(true);

    expect(linkDiscordMember).toHaveBeenCalledWith({
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      ashedMemberId: "m-1",
      memberDisplayName: "Alpha",
      gameUid: "123456789012",
    });
  });
});
