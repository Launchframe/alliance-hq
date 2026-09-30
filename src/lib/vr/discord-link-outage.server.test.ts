import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  lookupPlayerByUid,
  honorLookupFromDiscordClaimInvite,
  getDiscordBotPending,
  saveDiscordBotPending,
  writeDiscordBotAudit,
} = vi.hoisted(() => ({
  lookupPlayerByUid: vi.fn(),
  honorLookupFromDiscordClaimInvite: vi.fn(),
  getDiscordBotPending: vi.fn(),
  saveDiscordBotPending: vi.fn().mockResolvedValue(undefined),
  writeDiscordBotAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/lastwar/player-lookup.server", () => ({
  lookupPlayerByUid,
}));

vi.mock("@/lib/member-link/preapproved-link.server", () => ({
  honorLookupFromDiscordClaimInvite,
  tryPreApprovedMemberLink: vi.fn(),
}));

vi.mock("@/lib/vr/repository", () => ({
  getDiscordBotPending,
  saveDiscordBotPending,
  writeDiscordBotAudit,
  getAllianceById: vi.fn(),
  getDiscordHqLink: vi.fn(),
  getDiscordLinkById: vi.fn(),
  getGuildAllianceId: vi.fn(),
  getCommanderByAshedMemberId: vi.fn(),
  getLinkedMemberIds: vi.fn(),
  getMemberSeasonHigh: vi.fn(),
  listDiscordLinksForUser: vi.fn(),
  listSeasonVrRows: vi.fn(),
  linkDiscordMember: vi.fn(),
  maybeClaimNativeOwnerFromDiscordLink: vi.fn(),
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
  loadAllianceMembersForBot: vi.fn(),
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

import { handleDiscordLinkCommanderSlash } from "@/lib/vr/service";

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
    expect(result.reply).toContain("Bound Commander");
    expect(saveDiscordBotPending).toHaveBeenCalled();
  });
});
