import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  completeDiscordBotHqLink,
  syncDiscordHqLinkFromOAuthSignIn,
} from "@/lib/auth/discord-hq-link.server";
import { getDb } from "@/lib/db";
import {
  consumeDiscordAuthNonce,
  getValidDiscordAuthNonce,
} from "@/lib/vr/auth-nonce";
import { upsertDiscordHqLink } from "@/lib/vr/repository";

vi.mock("@/lib/vr/repository", () => ({
  upsertDiscordHqLink: vi.fn(),
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
    const where = vi.fn().mockResolvedValue(undefined);
    const deleteFn = vi.fn().mockReturnValue({ where });
    vi.mocked(getDb).mockReturnValue({ delete: deleteFn } as never);

    await syncDiscordHqLinkFromOAuthSignIn({
      discordUserId: "  discord-1  ",
      hqUserId: "  hq-1  ",
    });

    expect(deleteFn).toHaveBeenCalled();
    expect(where).toHaveBeenCalled();
    expect(upsertDiscordHqLink).toHaveBeenCalledWith({
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

    const where = vi.fn().mockResolvedValue(undefined);
    const deleteFn = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ providerAccountId: "discord-1" }]),
        }),
      }),
    });
    vi.mocked(getDb).mockReturnValue({ delete: deleteFn, select } as never);

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
