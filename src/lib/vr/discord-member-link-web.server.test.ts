import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/discord-member-link-gate.server", () => ({
  assertDiscordMemberLinkWebSession: vi.fn(),
}));

vi.mock("@/lib/vr/auth-nonce", () => ({
  consumeDiscordAuthNonce: vi.fn(),
  getValidDiscordAuthNonce: vi.fn(),
}));

vi.mock("@/lib/lastwar/player-lookup", () => ({
  isValidGameUid: vi.fn(),
  lookupPlayerByUid: vi.fn(),
}));

vi.mock("@/lib/vr/repository", () => ({
  getAllianceById: vi.fn(),
  getDiscordBotPending: vi.fn(),
  getDiscordUserLocale: vi.fn(),
  getGuildAllianceId: vi.fn(),
}));

vi.mock("@/lib/vr/resolve-member-link-alliance.server", () => ({
  resolveAllianceIdForDiscordMemberLink: vi.fn(),
}));

vi.mock("@/lib/vr/service", () => ({
  handleDiscordLinkCommanderSlash: vi.fn(),
  handleDiscordLinkFuzzyPick: vi.fn(),
  handleDiscordLinkIdentityConfirm: vi.fn(),
}));

import { assertDiscordMemberLinkWebSession } from "@/lib/auth/discord-member-link-gate.server";
import { consumeDiscordAuthNonce, getValidDiscordAuthNonce } from "@/lib/vr/auth-nonce";
import { isValidGameUid, lookupPlayerByUid } from "@/lib/lastwar/player-lookup";
import {
  getDiscordBotPending,
  getGuildAllianceId,
} from "@/lib/vr/repository";
import { resolveAllianceIdForDiscordMemberLink } from "@/lib/vr/resolve-member-link-alliance.server";
import {
  confirmDiscordMemberLinkFromWeb,
  pickDiscordMemberLinkFromWeb,
  previewDiscordMemberLinkFromWeb,
} from "@/lib/vr/discord-member-link-web.server";
import {
  handleDiscordLinkCommanderSlash,
  handleDiscordLinkFuzzyPick,
  handleDiscordLinkIdentityConfirm,
} from "@/lib/vr/service";

const memberLinkNonce = {
  id: "nonce-row-1",
  nonce: "abc123",
  purpose: "member_link" as const,
  discordUserId: "discord-user-1",
  guildId: "guild-1",
  tag: "_member_link",
};

describe("discord-member-link-web.server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertDiscordMemberLinkWebSession).mockResolvedValue({
      ok: true,
      discordUserId: "discord-user-1",
    });
    vi.mocked(isValidGameUid).mockReturnValue(true);
    vi.mocked(getValidDiscordAuthNonce).mockResolvedValue(memberLinkNonce as never);
    vi.mocked(getGuildAllianceId).mockResolvedValue(null);
    vi.mocked(getDiscordBotPending).mockResolvedValue(null);
  });

  it("returns guild_not_registered when preview cannot resolve an alliance", async () => {
    vi.mocked(lookupPlayerByUid).mockResolvedValue({
      ok: true,
      gameUserName: "Commander",
      gameUserLevel: 30,
      gameServerNumber: 42,
    } as never);
    vi.mocked(resolveAllianceIdForDiscordMemberLink).mockResolvedValue(null);

    const result = await previewDiscordMemberLinkFromWeb(
      { nonce: "abc123", gameUid: "1234567890121203" },
      "hq-user-1",
    );

    expect(result).toEqual({ outcome: "guild_not_registered" });
    expect(handleDiscordLinkCommanderSlash).not.toHaveBeenCalled();
  });

  it("uses cold-start alliance resolution on preview", async () => {
    vi.mocked(lookupPlayerByUid).mockResolvedValue({
      ok: true,
      gameUserName: "Commander",
      gameUserLevel: 30,
      gameServerNumber: 42,
    } as never);
    vi.mocked(resolveAllianceIdForDiscordMemberLink).mockResolvedValue("alliance-cold");
    vi.mocked(handleDiscordLinkCommanderSlash).mockResolvedValue({
      reply: "confirm?",
      pending: {
        kind: "link_confirm_identity",
        gameUid: "1234567890121203",
        gameUserName: "Commander",
        gameServerNumber: 42,
      },
      needsIdentityConfirmation: true,
    } as never);

    const result = await previewDiscordMemberLinkFromWeb(
      { nonce: "abc123", gameUid: "1234567890121203" },
      "hq-user-1",
    );

    expect(result).toEqual({
      outcome: "confirm_identity",
      gameUserName: "Commander",
      gameServerNumber: 42,
    });
    expect(handleDiscordLinkCommanderSlash).toHaveBeenCalledWith(
      expect.objectContaining({ allianceId: "alliance-cold" }),
    );
  });

  it("confirms using pending alliance when guild is not registered", async () => {
    vi.mocked(getDiscordBotPending).mockResolvedValue({
      allianceId: "alliance-from-pending",
      pending: {
        kind: "link_confirm_identity",
        gameUid: "1234567890121203",
        gameUserName: "Commander",
      },
    } as never);
    vi.mocked(handleDiscordLinkIdentityConfirm).mockResolvedValue({
      reply: "linked",
      linked: true,
      linkTarget: { ashedMemberId: "m1", memberDisplayName: "Commander" },
      pending: null,
    } as never);

    const result = await confirmDiscordMemberLinkFromWeb(
      { nonce: "abc123", answer: "yes" },
      "hq-user-1",
    );

    expect(result).toEqual({
      outcome: "linked",
      message: "linked",
      memberDisplayName: "Commander",
    });
    expect(handleDiscordLinkIdentityConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ allianceId: "alliance-from-pending" }),
    );
    expect(consumeDiscordAuthNonce).toHaveBeenCalledWith("nonce-row-1");
  });

  it("picks using pending alliance when guild is not registered", async () => {
    vi.mocked(getDiscordBotPending).mockResolvedValue({
      allianceId: "alliance-from-pending",
      pending: {
        kind: "link_fuzzy_pick",
        candidates: [{ memberId: "m1", name: "Commander" }],
        gameUid: "1234567890121203",
        gameUserName: "Commander",
        reportedName: "Commander",
      },
    } as never);
    vi.mocked(handleDiscordLinkFuzzyPick).mockResolvedValue({
      reply: "linked",
      linked: true,
      linkTarget: { ashedMemberId: "m1", memberDisplayName: "Commander" },
      pending: null,
    } as never);

    const result = await pickDiscordMemberLinkFromWeb(
      { nonce: "abc123", memberId: "m1" },
      "hq-user-1",
    );

    expect(result).toEqual({
      outcome: "linked",
      message: "linked",
      memberDisplayName: "Commander",
    });
    expect(handleDiscordLinkFuzzyPick).toHaveBeenCalledWith(
      expect.objectContaining({ allianceId: "alliance-from-pending" }),
    );
  });

  it("denies preview when web session gate fails", async () => {
    vi.mocked(assertDiscordMemberLinkWebSession).mockResolvedValue({
      ok: false,
      reason: "not_signed_in",
    });

    const result = await previewDiscordMemberLinkFromWeb(
      { nonce: "abc123", gameUid: "1234567890121203" },
      null,
    );

    expect(result).toEqual({
      outcome: "error",
      message: "Sign in to continue linking your commander.",
    });
  });
});
