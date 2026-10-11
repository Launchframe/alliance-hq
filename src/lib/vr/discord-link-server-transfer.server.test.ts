import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  lookupPlayerByUid,
  getDiscordBotPending,
  saveDiscordBotPending,
  writeDiscordBotAudit,
  getDiscordHqLink,
  getAllianceById,
  getLinkedMemberIds,
  linkDiscordMember,
  loadAllianceMembersForBot,
  resolveMemberLinkServerEligibilityForUid,
} = vi.hoisted(() => ({
  lookupPlayerByUid: vi.fn(),
  getDiscordBotPending: vi.fn(),
  saveDiscordBotPending: vi.fn().mockResolvedValue(undefined),
  writeDiscordBotAudit: vi.fn().mockResolvedValue(undefined),
  getDiscordHqLink: vi.fn(),
  getAllianceById: vi.fn(),
  getLinkedMemberIds: vi.fn(),
  linkDiscordMember: vi.fn(),
  loadAllianceMembersForBot: vi.fn(),
  resolveMemberLinkServerEligibilityForUid: vi.fn(),
}));

vi.mock("@/lib/lastwar/player-lookup.server", () => ({
  lookupPlayerByUid,
}));

vi.mock("@/lib/member-link/preapproved-link.server", () => ({
  honorLookupFromDiscordClaimInvite: vi.fn().mockResolvedValue(null),
  tryPreApprovedMemberLink: vi.fn(),
}));

vi.mock("@/lib/vr/repository", () => ({
  getDiscordBotPending,
  saveDiscordBotPending,
  writeDiscordBotAudit,
  getAllianceById,
  getDiscordHqLink,
  getDiscordLinkById: vi.fn(),
  getGuildAllianceId: vi.fn(),
  getCommanderByAshedMemberId: vi.fn(),
  getLinkedMemberIds,
  getMemberSeasonHigh: vi.fn(),
  listDiscordLinksForUser: vi.fn().mockResolvedValue([]),
  listSeasonVrRows: vi.fn(),
  linkDiscordMember,
  maybeClaimNativeOwnerFromDiscordLink: vi.fn().mockResolvedValue(undefined),
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
  loadAllianceMembersForBot,
  loadAllianceMembersForMemberLinkWithLiveRetry: vi.fn(),
}));

vi.mock("@/lib/member-link/inherit-hq-to-discord.server", () => ({
  ensureDiscordMemberLinksFromHq: vi.fn(),
}));

vi.mock("@/lib/member-link/roster-link-request.server", () => ({
  createDiscordRosterMissLinkRequest: vi.fn(),
}));

vi.mock("@/lib/member-link/server-eligibility.server", () => ({
  resolveMemberLinkServerEligibilityForUid,
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
  handleDiscordLinkHomeServerConfirm,
  handleDiscordLinkIdentityConfirm,
} from "@/lib/vr/service";

const GAME_UID = "1001369694001249";
const KNOWN_SERVER = 1211;
const ALLIANCE_SERVER = 1249;

const transferPending = {
  kind: "link_confirm_home_server" as const,
  gameUid: GAME_UID,
  gameUserName: "Snapz",
  lookupServer: ALLIANCE_SERVER,
  allianceServer: ALLIANCE_SERVER,
  knownServer: KNOWN_SERVER,
};

describe("Discord member link server transfer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lookupPlayerByUid.mockResolvedValue({
      ok: true,
      gameUserName: "Snapz",
      gameServerNumber: ALLIANCE_SERVER,
    });
    loadAllianceMembersForBot.mockResolvedValue([
      {
        id: "m-snapz",
        current_name: "Snapz",
        previous_names: [],
        status: "active",
      },
    ]);
    getLinkedMemberIds.mockResolvedValue(new Set());
    getAllianceById.mockResolvedValue({ tag: "CaOs" });
    getDiscordHqLink.mockResolvedValue(null);
    linkDiscordMember.mockResolvedValue({ ok: true, mode: "created" });
  });

  it("persists the transfer prompt with the known server instead of linking", async () => {
    getDiscordBotPending.mockResolvedValue({
      allianceId: "a1",
      pending: {
        kind: "link_confirm_identity",
        gameUid: GAME_UID,
        gameUserName: "Snapz",
        gameServerNumber: ALLIANCE_SERVER,
      },
    });
    resolveMemberLinkServerEligibilityForUid.mockResolvedValue({
      kind: "confirm_transfer",
      knownServer: KNOWN_SERVER,
      allianceServer: ALLIANCE_SERVER,
      knownCommanderHomeServer: KNOWN_SERVER,
    });

    const result = await handleDiscordLinkIdentityConfirm({
      allianceId: "a1",
      discordUserId: "d1",
      answer: "yes",
      locale: "en-US",
    });

    expect(result.needsServerTransferConfirmation).toBe(true);
    expect(result.linked).toBeFalsy();
    expect(result.reply).toContain(`server ${KNOWN_SERVER}`);
    expect(saveDiscordBotPending).toHaveBeenCalledWith(
      "a1",
      "d1",
      expect.objectContaining(transferPending),
    );
    expect(linkDiscordMember).not.toHaveBeenCalled();
  });

  it("tells a commander positioned elsewhere to go home and clears the prompt", async () => {
    getDiscordBotPending.mockResolvedValue({
      allianceId: "a1",
      pending: {
        kind: "link_confirm_identity",
        gameUid: GAME_UID,
        gameUserName: "Snapz",
        gameServerNumber: ALLIANCE_SERVER,
      },
    });
    resolveMemberLinkServerEligibilityForUid.mockResolvedValue({
      kind: "rejected",
      reason: "transfer_position_mismatch",
      allianceServer: ALLIANCE_SERVER,
      knownCommanderHomeServer: KNOWN_SERVER,
    });

    const result = await handleDiscordLinkIdentityConfirm({
      allianceId: "a1",
      discordUserId: "d1",
      answer: "yes",
      locale: "en-US",
    });

    expect(result.serverTransferSendHome).toBe(true);
    expect(result.pending).toBeNull();
    expect(result.reply).toMatch(/send your Commander home/i);
    expect(saveDiscordBotPending).toHaveBeenCalledWith("a1", "d1", null);
    expect(linkDiscordMember).not.toHaveBeenCalled();
  });

  it("declining the transfer (known) returns wrong-server guidance without linking", async () => {
    getDiscordBotPending.mockResolvedValue({
      allianceId: "a1",
      pending: transferPending,
    });

    const result = await handleDiscordLinkHomeServerConfirm({
      allianceId: "a1",
      discordUserId: "d1",
      choice: "known",
      locale: "en-US",
      expectedGameUid: GAME_UID,
    });

    expect(result.wrongServer).toBe(true);
    expect(result.linked).toBeFalsy();
    expect(saveDiscordBotPending).toHaveBeenCalledWith("a1", "d1", null);
    expect(lookupPlayerByUid).not.toHaveBeenCalled();
    expect(resolveMemberLinkServerEligibilityForUid).not.toHaveBeenCalled();
    expect(linkDiscordMember).not.toHaveBeenCalled();
  });

  it("confirming the transfer (alliance) re-checks eligibility and links", async () => {
    getDiscordBotPending.mockResolvedValue({
      allianceId: "a1",
      pending: transferPending,
    });
    resolveMemberLinkServerEligibilityForUid.mockResolvedValue({
      kind: "eligible",
      reason: "user_confirmed_server_transfer",
      allianceServer: ALLIANCE_SERVER,
      knownCommanderHomeServer: KNOWN_SERVER,
    });

    const result = await handleDiscordLinkHomeServerConfirm({
      allianceId: "a1",
      discordUserId: "d1",
      choice: "alliance",
      locale: "en-US",
      expectedGameUid: GAME_UID,
    });

    expect(resolveMemberLinkServerEligibilityForUid).toHaveBeenCalledWith(
      expect.objectContaining({
        allianceId: "a1",
        gameUid: GAME_UID,
        lookupServer: ALLIANCE_SERVER,
        allianceHomeConfirmed: true,
        discordUserId: "d1",
      }),
    );
    expect(result.linked).toBe(true);
    expect(linkDiscordMember).toHaveBeenCalledWith(
      expect.objectContaining({ ashedMemberId: "m-snapz", gameUid: GAME_UID }),
    );
  });
});
