import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  lookupPlayerByUid,
  honorLookupFromDiscordClaimInvite,
  tryPreApprovedMemberLink,
  getDiscordBotPending,
  saveDiscordBotPending,
  writeDiscordBotAudit,
  getDiscordHqLink,
  listDiscordLinksForUser,
  linkDiscordMember,
  maybeClaimNativeOwnerFromDiscordLink,
} = vi.hoisted(() => ({
  lookupPlayerByUid: vi.fn(),
  honorLookupFromDiscordClaimInvite: vi.fn(),
  tryPreApprovedMemberLink: vi.fn(),
  getDiscordBotPending: vi.fn(),
  saveDiscordBotPending: vi.fn().mockResolvedValue(undefined),
  writeDiscordBotAudit: vi.fn().mockResolvedValue(undefined),
  getDiscordHqLink: vi.fn(),
  listDiscordLinksForUser: vi.fn().mockResolvedValue([]),
  linkDiscordMember: vi.fn(),
  maybeClaimNativeOwnerFromDiscordLink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/lastwar/player-lookup.server", () => ({
  lookupPlayerByUid,
}));

vi.mock("@/lib/member-link/preapproved-link.server", () => ({
  honorLookupFromDiscordClaimInvite,
  tryPreApprovedMemberLink,
}));

vi.mock("@/lib/vr/repository", () => ({
  getDiscordBotPending,
  saveDiscordBotPending,
  writeDiscordBotAudit,
  getAllianceById: vi.fn(),
  getDiscordHqLink,
  getDiscordLinkById: vi.fn(),
  getGuildAllianceId: vi.fn(),
  getCommanderByAshedMemberId: vi.fn(),
  getLinkedMemberIds: vi.fn(),
  getMemberSeasonHigh: vi.fn(),
  listDiscordLinksForUser,
  listSeasonVrRows: vi.fn(),
  linkDiscordMember,
  maybeClaimNativeOwnerFromDiscordLink,
  resolveVrSeasonContext: vi.fn(),
  setWeeklyPass: vi.fn(),
  upsertMemberSeasonVr: vi.fn(),
  countSeasonReporters: vi.fn(),
}));

vi.mock("@/lib/events/admin-alerts", () => ({
  emitAdminAlert: vi.fn(),
}));

vi.mock("@/lib/vr/auth-nonce", () => ({
  createDiscordAuthNonce: vi.fn(),
}));

vi.mock("@/lib/vr/member-roster", () => ({
  loadAllianceMembersForBot: vi.fn().mockResolvedValue([]),
  loadAllianceMembersForMemberLinkWithLiveRetry: vi.fn(),
}));

vi.mock("@/lib/member-link/inherit-hq-to-discord.server", () => ({
  ensureDiscordMemberLinksFromHq: vi.fn(),
}));

vi.mock("@/lib/member-link/roster-link-request.server", () => ({
  createDiscordRosterMissLinkRequest: vi.fn(),
}));

vi.mock("@/lib/member-link/server-eligibility.server", () => ({
  resolveMemberLinkServerEligibilityForUid: vi.fn(),
}));

vi.mock("@/lib/member-link/self-service-onboarding.server", () => ({
  trySelfServiceMemberLink: vi.fn(),
}));

vi.mock("@/lib/members/commander-identity.server", () => ({
  syncCommanderIdentityFromMemberLink: vi.fn(),
}));

vi.mock("@/lib/lastwar/sync-member-game-level.server", () => ({
  syncAllianceMemberGameLevelFromLastWar: vi.fn(),
}));

import {
  handleDiscordLinkCommanderSlash,
  handleDiscordLinkIdentityConfirm,
} from "@/lib/vr/service";
import { resolveMemberLinkServerEligibilityForUid } from "@/lib/member-link/server-eligibility.server";

describe("handleDiscordLinkCommanderSlash Last War outage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDiscordBotPending.mockResolvedValue(null);
  });

  it("asks for an R4 claim invite when lookup fails and no claim invite is bound", async () => {
    lookupPlayerByUid.mockResolvedValue({
      ok: false,
      reason: "request_failed",
      message: "down",
    });
    honorLookupFromDiscordClaimInvite.mockResolvedValue(null);

    const result = await handleDiscordLinkCommanderSlash({
      allianceId: "a1",
      discordUserId: "d1",
      gameUid: "1001369694001203",
      locale: "en-US",
    });

    expect(result.pending).toBeNull();
    expect(result.reply).toMatch(/claim invite/i);
    expect(saveDiscordBotPending).not.toHaveBeenCalled();
  });

  it("previews honor-system identity when a claim invite is bound", async () => {
    lookupPlayerByUid.mockResolvedValue({
      ok: false,
      reason: "request_failed",
      message: "down",
    });
    honorLookupFromDiscordClaimInvite.mockResolvedValue({
      ok: true,
      gameUserName: "Bound Commander",
    });

    const result = await handleDiscordLinkCommanderSlash({
      allianceId: "a1",
      discordUserId: "d1",
      gameUid: "1001369694001203",
      locale: "en-US",
    });

    expect(result.needsIdentityConfirmation).toBe(true);
    expect(result.pending).toEqual(
      expect.objectContaining({
        kind: "link_confirm_identity",
        gameUid: "1001369694001203",
        gameUserName: "Bound Commander",
      }),
    );
    expect(result.reply).toMatch(/claim invite/i);
    expect(result.reply).toContain("Bound Commander");
    expect(saveDiscordBotPending).toHaveBeenCalled();
  });
});

describe("handleDiscordLinkIdentityConfirm Last War outage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDiscordBotPending.mockResolvedValue({
      allianceId: "a1",
      pending: {
        kind: "link_confirm_identity",
        gameUid: "1001369694001203",
        gameUserName: "Bound Commander",
      },
    });
    getDiscordHqLink.mockResolvedValue({ hqUserId: "hq-1" });
    linkDiscordMember.mockResolvedValue({ ok: true, mode: "created" });
  });

  it("honor-links via claim invite even when the commander is already on the roster", async () => {
    lookupPlayerByUid.mockResolvedValue({
      ok: false,
      reason: "request_failed",
      message: "down",
    });
    honorLookupFromDiscordClaimInvite.mockResolvedValue({
      ok: true,
      gameUserName: "Bound Commander",
    });
    tryPreApprovedMemberLink.mockResolvedValue({
      ok: true,
      target: {
        ashedMemberId: "m-claim",
        memberDisplayName: "Bound Commander",
        gameUid: "1001369694001203",
        source: "claim_invite",
      },
    });

    const result = await handleDiscordLinkIdentityConfirm({
      allianceId: "a1",
      discordUserId: "d1",
      answer: "yes",
      locale: "en-US",
    });

    expect(tryPreApprovedMemberLink).toHaveBeenCalledWith(
      expect.objectContaining({
        honorSystem: true,
        hqUserId: "hq-1",
        gameUid: "1001369694001203",
      }),
    );
    expect(resolveMemberLinkServerEligibilityForUid).not.toHaveBeenCalled();
    expect(linkDiscordMember).toHaveBeenCalled();
    expect(result.linked).toBe(true);
    expect(result.reply).toMatch(/verification was unavailable/i);
    expect(result.reply).toContain("Bound Commander");
  });

  it("asks for an R4 claim invite when outage confirm has no claim invite and no live pending server", async () => {
    lookupPlayerByUid.mockResolvedValue({
      ok: false,
      reason: "request_failed",
      message: "down",
    });
    honorLookupFromDiscordClaimInvite.mockResolvedValue(null);

    const result = await handleDiscordLinkIdentityConfirm({
      allianceId: "a1",
      discordUserId: "d1",
      answer: "yes",
      locale: "en-US",
    });

    expect(tryPreApprovedMemberLink).not.toHaveBeenCalled();
    expect(result.pending).toBeNull();
    expect(result.reply).toMatch(/claim invite/i);
  });

  it("keeps a previously verified pending identity when confirm lookup fails", async () => {
    getDiscordBotPending.mockResolvedValue({
      allianceId: "a1",
      pending: {
        kind: "link_confirm_identity",
        gameUid: "1001369694001203",
        gameUserName: "Live Name",
        gameServerNumber: 1203,
      },
    });
    lookupPlayerByUid.mockResolvedValue({
      ok: false,
      reason: "request_failed",
      message: "down",
    });
    // Would return a different invite name if honor were wrongly applied.
    honorLookupFromDiscordClaimInvite.mockResolvedValue({
      ok: true,
      gameUserName: "Invite Name",
    });

    // Finalize without honor still needs roster/server path — stub eligibility ok.
    const { loadAllianceMembersForBot } = await import("@/lib/vr/member-roster");
    const { getLinkedMemberIds, getAllianceById } = await import(
      "@/lib/vr/repository"
    );
    vi.mocked(loadAllianceMembersForBot).mockResolvedValue([
      {
        id: "m-1",
        current_name: "Live Name",
        previous_names: [],
        status: "active",
      } as never,
    ]);
    vi.mocked(getLinkedMemberIds).mockResolvedValue(new Set());
    vi.mocked(getAllianceById).mockResolvedValue({ tag: "TST" } as never);
    vi.mocked(resolveMemberLinkServerEligibilityForUid).mockResolvedValue({
      kind: "ok",
    } as never);

    const result = await handleDiscordLinkIdentityConfirm({
      allianceId: "a1",
      discordUserId: "d1",
      answer: "yes",
      locale: "en-US",
    });

    expect(tryPreApprovedMemberLink).not.toHaveBeenCalledWith(
      expect.objectContaining({ honorSystem: true }),
    );
    expect(honorLookupFromDiscordClaimInvite).not.toHaveBeenCalled();
    expect(result.linked).toBe(true);
    expect(linkDiscordMember).toHaveBeenCalledWith(
      expect.objectContaining({
        memberDisplayName: "Live Name",
        ashedMemberId: "m-1",
      }),
    );
  });
});
