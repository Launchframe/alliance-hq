import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveDiscordMemberLinkGate } from "@/lib/auth/discord-member-link-gate.server";
import {
  getDiscordProviderAccountIdForHqUser,
  syncDiscordHqLinkFromOAuthSignIn,
} from "@/lib/auth/discord-hq-link.server";
import { hqUserHasActiveAllianceMembership } from "@/lib/native-alliance/access";
import { getValidDiscordAuthNonce } from "@/lib/vr/auth-nonce";

vi.mock("@/lib/auth/discord-hq-link.server", () => ({
  getDiscordProviderAccountIdForHqUser: vi.fn(),
  syncDiscordHqLinkFromOAuthSignIn: vi.fn(),
}));

vi.mock("@/lib/native-alliance/access", () => ({
  hqUserHasActiveAllianceMembership: vi.fn(),
}));

vi.mock("@/lib/vr/auth-nonce", () => ({
  getValidDiscordAuthNonce: vi.fn(),
}));

const memberLinkNonce = {
  id: "nonce-1",
  purpose: "member_link" as const,
  discordUserId: "discord-caller",
  guildId: "guild-1",
  tag: null,
};

describe("resolveDiscordMemberLinkGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns invalid_nonce when nonce is missing or wrong purpose", async () => {
    vi.mocked(getValidDiscordAuthNonce).mockResolvedValue(null as never);

    expect(
      await resolveDiscordMemberLinkGate({ nonce: "bad", hqUserId: "hq-1" }),
    ).toEqual({ kind: "invalid_nonce" });
  });

  it("requires auth when hq user is absent", async () => {
    vi.mocked(getValidDiscordAuthNonce).mockResolvedValue(memberLinkNonce as never);

    expect(await resolveDiscordMemberLinkGate({ nonce: "n1", hqUserId: null })).toEqual({
      kind: "needs_auth",
      returnPath: "/discord/link-commander?nonce=n1",
    });
  });

  it("requires Discord OAuth when HQ user has no Discord provider", async () => {
    vi.mocked(getValidDiscordAuthNonce).mockResolvedValue(memberLinkNonce as never);
    vi.mocked(getDiscordProviderAccountIdForHqUser).mockResolvedValue(null);

    expect(await resolveDiscordMemberLinkGate({ nonce: "n1", hqUserId: "hq-1" })).toEqual({
      kind: "needs_discord_oauth",
      nonce: "n1",
      returnPath: "/discord/link-commander?nonce=n1",
    });
  });

  it("rejects when signed-in Discord does not match slash caller", async () => {
    vi.mocked(getValidDiscordAuthNonce).mockResolvedValue(memberLinkNonce as never);
    vi.mocked(getDiscordProviderAccountIdForHqUser).mockResolvedValue("discord-other");

    expect(await resolveDiscordMemberLinkGate({ nonce: "n1", hqUserId: "hq-1" })).toEqual({
      kind: "discord_mismatch",
    });
  });

  it("requires join code when Discord matches but user has no alliance membership", async () => {
    vi.mocked(getValidDiscordAuthNonce).mockResolvedValue(memberLinkNonce as never);
    vi.mocked(getDiscordProviderAccountIdForHqUser).mockResolvedValue("discord-caller");
    vi.mocked(hqUserHasActiveAllianceMembership).mockResolvedValue(false);

    expect(await resolveDiscordMemberLinkGate({ nonce: "n1", hqUserId: "hq-1" })).toEqual({
      kind: "needs_join_code",
      nonce: "n1",
      returnPath: "/discord/link-commander?nonce=n1",
    });
    expect(syncDiscordHqLinkFromOAuthSignIn).toHaveBeenCalledWith({
      discordUserId: "discord-caller",
      hqUserId: "hq-1",
    });
  });

  it("is ready when Discord matches and membership exists", async () => {
    vi.mocked(getValidDiscordAuthNonce).mockResolvedValue(memberLinkNonce as never);
    vi.mocked(getDiscordProviderAccountIdForHqUser).mockResolvedValue("discord-caller");
    vi.mocked(hqUserHasActiveAllianceMembership).mockResolvedValue(true);

    expect(await resolveDiscordMemberLinkGate({ nonce: "n1", hqUserId: "hq-1" })).toEqual({
      kind: "ready",
      nonce: "n1",
      discordUserId: "discord-caller",
    });
  });
});
