import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  handleDiscordWhoIs,
  handleDiscordWhoIsClaimInvite,
} from "@/lib/discord/who-is-bot-handlers.server";

vi.mock("@/lib/discord/claim-invite-auth.server", () => ({
  callerCanIssueClaimInviteFromDiscord: vi.fn(),
}));

vi.mock("@/lib/member-link/inherit-hq-to-discord.server", () => ({
  ensureDiscordMemberLinksFromHq: vi.fn(),
}));

vi.mock("@/lib/member-link/repository.server", () => ({
  getHqMemberLinkByAllianceAndMember: vi.fn(),
}));

vi.mock("@/lib/native-alliance/join-codes", () => ({
  createAllianceJoinCode: vi.fn(),
}));

vi.mock("@/lib/native-alliance/invite-share-payload.server", () => ({
  loadAllianceInviteShareContext: vi.fn(),
  buildJoinCodeSharePayload: vi.fn(),
}));

vi.mock("@/lib/vr/member-roster", () => ({
  loadAllianceMembersForBot: vi.fn(),
}));

vi.mock("@/lib/vr/repository", () => ({
  getAllianceById: vi.fn(),
  getDiscordLinkByAllianceAndMember: vi.fn(),
  getLinkedMemberIds: vi.fn(),
  listDiscordLinksForUser: vi.fn(),
  writeDiscordBotAudit: vi.fn(),
}));

vi.mock("@/lib/vr/bot-member-links.server", () => ({
  listDiscordLinksForStatusQuery: vi.fn(),
}));

import { callerCanIssueClaimInviteFromDiscord } from "@/lib/discord/claim-invite-auth.server";
import { getHqMemberLinkByAllianceAndMember } from "@/lib/member-link/repository.server";
import { createAllianceJoinCode } from "@/lib/native-alliance/join-codes";
import {
  buildJoinCodeSharePayload,
  loadAllianceInviteShareContext,
} from "@/lib/native-alliance/invite-share-payload.server";
import { listDiscordLinksForStatusQuery } from "@/lib/vr/bot-member-links.server";
import { loadAllianceMembersForBot } from "@/lib/vr/member-roster";
import {
  getAllianceById,
  getDiscordLinkByAllianceAndMember,
  getLinkedMemberIds,
  listDiscordLinksForUser,
} from "@/lib/vr/repository";

const members = [
  {
    id: "m1",
    current_name: "Alpha",
    previous_names: [],
    status: "active",
  },
  {
    id: "m2",
    current_name: "Beta",
    previous_names: [],
    status: "active",
  },
];

const callerLink = {
  id: "link-caller",
  allianceId: "a1",
  discordUserId: "d-caller",
  discordUsername: "caller",
  ashedMemberId: "m-caller",
  memberDisplayName: "Caller",
  gameUid: "111",
  linkedAt: new Date(),
  updatedAt: new Date(),
};

describe("handleDiscordWhoIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listDiscordLinksForStatusQuery).mockResolvedValue([callerLink]);
    vi.mocked(getAllianceById).mockResolvedValue({ tag: "TAG" } as never);
    vi.mocked(loadAllianceMembersForBot).mockResolvedValue(members as never);
    vi.mocked(getLinkedMemberIds).mockResolvedValue(new Set());
    vi.mocked(callerCanIssueClaimInviteFromDiscord).mockResolvedValue(false);
  });

  it("requires the caller to be linked", async () => {
    vi.mocked(listDiscordLinksForStatusQuery).mockResolvedValue([]);
    const result = await handleDiscordWhoIs({
      allianceId: "a1",
      discordUserId: "d-caller",
      locale: "en-US",
      targetDiscordUserId: "d-target",
    });
    expect(result.reply).toMatch(/link-commander/i);
  });

  it("returns usage when both options are missing", async () => {
    const result = await handleDiscordWhoIs({
      allianceId: "a1",
      discordUserId: "d-caller",
      locale: "en-US",
    });
    expect(result.reply).toMatch(/who-is discord/i);
  });

  it("lists commanders for a Discord user", async () => {
    vi.mocked(listDiscordLinksForUser).mockResolvedValue([
      {
        ...callerLink,
        discordUserId: "d-target",
        memberDisplayName: "Alpha",
        ashedMemberId: "m1",
      },
    ]);
    const result = await handleDiscordWhoIs({
      allianceId: "a1",
      discordUserId: "d-caller",
      locale: "en-US",
      targetDiscordUserId: "d-target",
    });
    expect(result.reply).toContain("Alpha");
    expect(result.reply).toContain("<@d-target>");
  });

  it("reports when a Discord user has no linked commander", async () => {
    vi.mocked(listDiscordLinksForUser).mockResolvedValue([]);
    const result = await handleDiscordWhoIs({
      allianceId: "a1",
      discordUserId: "d-caller",
      locale: "en-US",
      targetDiscordUserId: "d-target",
    });
    expect(result.reply).toMatch(/no linked commander/i);
  });

  it("returns the Discord owner for an exact commander match", async () => {
    vi.mocked(getDiscordLinkByAllianceAndMember).mockResolvedValue({
      discordUserId: "d-owner",
      discordUsername: "owner",
    } as never);
    const result = await handleDiscordWhoIs({
      allianceId: "a1",
      discordUserId: "d-caller",
      locale: "en-US",
      commanderName: "Alpha",
    });
    expect(result.reply).toContain("Alpha");
    expect(result.reply).toContain("<@d-owner>");
  });

  it("reports HQ-only linkage without a claim invite", async () => {
    vi.mocked(getDiscordLinkByAllianceAndMember).mockResolvedValue(null as never);
    vi.mocked(getHqMemberLinkByAllianceAndMember).mockResolvedValue({
      id: "hq-1",
    } as never);
    const result = await handleDiscordWhoIs({
      allianceId: "a1",
      discordUserId: "d-caller",
      locale: "en-US",
      commanderName: "Alpha",
    });
    expect(result.reply).toMatch(/Alliance HQ/i);
    expect(result.claimInvite).toBeUndefined();
  });

  it("offers a claim invite button for unclaimed commanders to officers", async () => {
    vi.mocked(getDiscordLinkByAllianceAndMember).mockResolvedValue(null as never);
    vi.mocked(getHqMemberLinkByAllianceAndMember).mockResolvedValue(null as never);
    vi.mocked(callerCanIssueClaimInviteFromDiscord).mockResolvedValue(true);
    const result = await handleDiscordWhoIs({
      allianceId: "a1",
      discordUserId: "d-caller",
      locale: "en-US",
      commanderName: "Alpha",
    });
    expect(result.claimInvite).toEqual({
      ashedMemberId: "m1",
      commanderName: "Alpha",
    });
  });

  it("does not offer a claim invite to regular members", async () => {
    vi.mocked(getDiscordLinkByAllianceAndMember).mockResolvedValue(null as never);
    vi.mocked(getHqMemberLinkByAllianceAndMember).mockResolvedValue(null as never);
    const result = await handleDiscordWhoIs({
      allianceId: "a1",
      discordUserId: "d-caller",
      locale: "en-US",
      commanderName: "Alpha",
    });
    expect(result.reply).toMatch(/not linked to any account/i);
    expect(result.claimInvite).toBeUndefined();
  });

  it("returns pick candidates for ambiguous commander names", async () => {
    vi.mocked(loadAllianceMembersForBot).mockResolvedValue([
      { id: "m1", current_name: "Alpha One", previous_names: [], status: "active" },
      { id: "m2", current_name: "Alpha Two", previous_names: [], status: "active" },
    ] as never);
    const result = await handleDiscordWhoIs({
      allianceId: "a1",
      discordUserId: "d-caller",
      locale: "en-US",
      commanderName: "Alpha",
    });
    expect(result.pickCandidates).toHaveLength(2);
  });
});

describe("handleDiscordWhoIsClaimInvite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listDiscordLinksForStatusQuery).mockResolvedValue([callerLink]);
    vi.mocked(callerCanIssueClaimInviteFromDiscord).mockResolvedValue(true);
    vi.mocked(createAllianceJoinCode).mockResolvedValue({
      joinCodeId: "jc-1",
      code: "TAG-ABC123",
      targetCommanderName: "Alpha",
    } as never);
    vi.mocked(loadAllianceInviteShareContext).mockResolvedValue({
      allianceName: "Test Alliance",
      allianceTag: "TAG",
    });
    vi.mocked(buildJoinCodeSharePayload).mockReturnValue({
      welcomeUrl: "https://example.com/welcome",
      shareMessage: "Share this code",
      welcomeUrlRequiresAllianceTag: false,
    });
  });

  it("denies claim invite creation for non-officers", async () => {
    vi.mocked(callerCanIssueClaimInviteFromDiscord).mockResolvedValue(false);
    const result = await handleDiscordWhoIsClaimInvite({
      allianceId: "a1",
      discordUserId: "d-caller",
      locale: "en-US",
      ashedMemberId: "m1",
    });
    expect(result.reply).toMatch(/Only officers/i);
    expect(createAllianceJoinCode).not.toHaveBeenCalled();
  });

  it("creates a claim invite for officers", async () => {
    const result = await handleDiscordWhoIsClaimInvite({
      allianceId: "a1",
      discordUserId: "d-caller",
      locale: "en-US",
      ashedMemberId: "m1",
    });
    expect(createAllianceJoinCode).toHaveBeenCalledWith({
      allianceId: "a1",
      roleName: "member",
      maxRedemptions: 1,
      targetAshedMemberId: "m1",
    });
    expect(result.reply).toContain("TAG-ABC123");
  });
});
