import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  completeDiscordBotHqLink,
  syncDiscordHqLinkFromOAuthSignIn,
  unlinkDiscordHqLinkForUser,
} from "@/lib/auth/discord-hq-link.server";
import { unlinkOAuthProviderForUser } from "@/lib/auth/account-linking.server";
import { getDb } from "@/lib/db";
import {
  consumeDiscordAuthNonce,
  getValidDiscordAuthNonce,
} from "@/lib/vr/auth-nonce";
import { inheritHqMemberLinksToDiscord, revokeHqMirroredDiscordMemberLinks } from "@/lib/member-link/inherit-hq-to-discord.server";
import {
  deleteDiscordHqLinkForHqUser,
  upsertDiscordHqLink,
} from "@/lib/vr/repository";

vi.mock("@/lib/vr/repository", () => ({
  deleteDiscordHqLinkForHqUser: vi.fn(),
  upsertDiscordHqLink: vi.fn(),
}));

vi.mock("@/lib/member-link/inherit-hq-to-discord.server", () => ({
  inheritHqMemberLinksToDiscord: vi.fn().mockResolvedValue({
    inherited: 0,
    skipped: 0,
  }),
  revokeHqMirroredDiscordMemberLinks: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/auth/account-linking.server", () => ({
  unlinkOAuthProviderForUser: vi.fn(),
}));

vi.mock("@/lib/vr/auth-nonce", () => ({
  getValidDiscordAuthNonce: vi.fn(),
  consumeDiscordAuthNonce: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: vi.fn(),
  schema: {
    discordHqLinks: {
      hqUserId: "hqUserId",
      discordUserId: "discordUserId",
    },
    hqAuthAccounts: {
      hqUserId: "hqUserId",
      provider: "provider",
      providerAccountId: "providerAccountId",
    },
  },
}));

describe("syncDiscordHqLinkFromOAuthSignIn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("no-ops when discord or hq user id is blank", async () => {
    await syncDiscordHqLinkFromOAuthSignIn({
      discordUserId: "  ",
      hqUserId: "hq-1",
    });
    await syncDiscordHqLinkFromOAuthSignIn({
      discordUserId: "discord-1",
      hqUserId: "",
    });

    expect(getDb).not.toHaveBeenCalled();
    expect(upsertDiscordHqLink).not.toHaveBeenCalled();
  });

  it("clears stale HQ bindings then upserts discord_hq_links", async () => {
    const staleWhere = vi.fn().mockResolvedValue([
      { discordUserId: "discord-old" },
    ]);
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({ where: staleWhere }),
    });
    const deleteFn = vi.fn().mockReturnValue({ where: deleteWhere });
    vi.mocked(getDb).mockReturnValue({ select, delete: deleteFn } as never);

    await syncDiscordHqLinkFromOAuthSignIn({
      discordUserId: "  discord-1  ",
      hqUserId: "  hq-1  ",
    });

    expect(revokeHqMirroredDiscordMemberLinks).toHaveBeenCalledWith({
      discordUserId: "discord-old",
      hqUserId: "hq-1",
    });
    expect(deleteFn).toHaveBeenCalled();
    expect(deleteWhere).toHaveBeenCalled();
    expect(upsertDiscordHqLink).toHaveBeenCalledWith({
      discordUserId: "discord-1",
      hqUserId: "hq-1",
    });
    expect(inheritHqMemberLinksToDiscord).toHaveBeenCalledWith({
      discordUserId: "discord-1",
      hqUserId: "hq-1",
    });
  });
});

describe("completeDiscordBotHqLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects blank nonce", async () => {
    expect(await completeDiscordBotHqLink({ nonce: "  ", hqUserId: "hq-1" })).toEqual({
      ok: false,
      reason: "missing_nonce",
    });
  });

  it("rejects expired or unknown nonce", async () => {
    vi.mocked(getValidDiscordAuthNonce).mockResolvedValue(null as never);

    expect(
      await completeDiscordBotHqLink({ nonce: "abc", hqUserId: "hq-1" }),
    ).toEqual({ ok: false, reason: "expired_nonce" });
  });

  it("rejects non user_link purpose", async () => {
    vi.mocked(getValidDiscordAuthNonce).mockResolvedValue({
      id: "nonce-1",
      purpose: "alliance_credentials",
      discordUserId: "discord-1",
    } as never);

    expect(
      await completeDiscordBotHqLink({ nonce: "abc", hqUserId: "hq-1" }),
    ).toEqual({ ok: false, reason: "wrong_purpose" });
  });

  it("rejects when OAuth Discord account does not match slash caller", async () => {
    vi.mocked(getValidDiscordAuthNonce).mockResolvedValue({
      id: "nonce-1",
      purpose: "user_link",
      discordUserId: "discord-caller",
    } as never);

    const select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ providerAccountId: "discord-other" }]),
        }),
      }),
    });
    vi.mocked(getDb).mockReturnValue({ select } as never);

    expect(
      await completeDiscordBotHqLink({ nonce: "abc", hqUserId: "hq-1" }),
    ).toEqual({ ok: false, reason: "discord_mismatch" });
  });

  it("upserts discord_hq_links and consumes nonce on success", async () => {
    vi.mocked(getValidDiscordAuthNonce).mockResolvedValue({
      id: "nonce-1",
      purpose: "user_link",
      discordUserId: "discord-1",
    } as never);

    const staleWhere = vi.fn().mockResolvedValue([]);
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const deleteFn = vi.fn().mockReturnValue({ where: deleteWhere });
    const oauthSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ providerAccountId: "discord-1" }]),
        }),
      }),
    });
    let selectCall = 0;
    vi.mocked(getDb).mockReturnValue({
      delete: deleteFn,
      select: vi.fn().mockImplementation(() => {
        selectCall += 1;
        if (selectCall === 1) {
          return oauthSelect();
        }
        return { from: vi.fn().mockReturnValue({ where: staleWhere }) };
      }),
    } as never);

    expect(
      await completeDiscordBotHqLink({ nonce: "abc", hqUserId: "hq-1" }),
    ).toEqual({ ok: true });

    expect(upsertDiscordHqLink).toHaveBeenCalledWith({
      discordUserId: "discord-1",
      hqUserId: "hq-1",
    });
    expect(consumeDiscordAuthNonce).toHaveBeenCalledWith("nonce-1");
  });
});

describe("unlinkDiscordHqLinkForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves the bot link when Discord OAuth is the last sign-in method", async () => {
    vi.mocked(unlinkOAuthProviderForUser).mockResolvedValue({
      ok: false,
      code: "last_method",
    });

    await expect(unlinkDiscordHqLinkForUser("  hq-1  ")).resolves.toEqual({
      ok: false,
      reason: "last_sign_in_method",
    });

    expect(unlinkOAuthProviderForUser).toHaveBeenCalledWith({
      hqUserId: "hq-1",
      provider: "discord",
    });
    expect(deleteDiscordHqLinkForHqUser).not.toHaveBeenCalled();
  });

  it("removes the bot link after Discord OAuth unlink succeeds", async () => {
    vi.mocked(unlinkOAuthProviderForUser).mockResolvedValue({ ok: true });
    vi.mocked(deleteDiscordHqLinkForHqUser).mockResolvedValue(true);

    await expect(unlinkDiscordHqLinkForUser("hq-1")).resolves.toEqual({
      ok: true,
    });

    expect(deleteDiscordHqLinkForHqUser).toHaveBeenCalledWith("hq-1");
  });

  it("removes an orphan bot link when Discord OAuth is already absent", async () => {
    vi.mocked(unlinkOAuthProviderForUser).mockResolvedValue({
      ok: false,
      code: "not_linked",
    });
    vi.mocked(deleteDiscordHqLinkForHqUser).mockResolvedValue(true);

    await expect(unlinkDiscordHqLinkForUser("hq-1")).resolves.toEqual({
      ok: true,
    });
  });
});
