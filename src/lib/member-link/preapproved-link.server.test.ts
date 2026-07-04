import { beforeEach, describe, expect, it, vi } from "vitest";

import { tryPreApprovedMemberLink } from "@/lib/member-link/preapproved-link.server";
import { surfaceClaimConflict } from "@/lib/member-link/claim.server";
import { getHqMemberLinkForUser, linkHqMember } from "@/lib/member-link/repository.server";
import { findAcceptedClaimInviteForUser } from "@/lib/native-alliance/invites";
import { getDb } from "@/lib/db";
import { getLinkedMemberIds } from "@/lib/vr/repository";

vi.mock("@/lib/member-link/claim.server", () => ({
  surfaceClaimConflict: vi.fn(),
}));

vi.mock("@/lib/member-link/repository.server", () => ({
  getHqMemberLinkForUser: vi.fn(),
  linkHqMember: vi.fn(),
  maybeSetOwnerMemberExternalId: vi.fn(),
  saveHqMemberLinkPending: vi.fn(),
  syncPrimaryGameUidFromHqMemberLink: vi.fn(),
}));

vi.mock("@/lib/native-alliance/invites", () => ({
  findAcceptedClaimInviteForUser: vi.fn(),
}));

vi.mock("@/lib/member-link/roster-link-resolve.server", () => ({
  reconcileAllianceMemberForRosterLink: vi.fn(),
}));

vi.mock("@/lib/lastwar/sync-member-game-level.server", () => ({
  syncAllianceMemberGameLevelFromLastWar: vi.fn(),
}));

vi.mock("@/lib/vr/repository", () => ({
  getLinkedMemberIds: vi.fn(),
  getAllianceById: vi.fn().mockResolvedValue({ tag: "LFgo" }),
}));

vi.mock("@/lib/db", () => ({
  getDb: vi.fn(),
  schema: {
    allianceMembers: {
      allianceId: "allianceId",
      ashedMemberId: "ashedMemberId",
      currentName: "currentName",
      previousNamesJson: "previousNamesJson",
      status: "status",
    },
  },
}));

const lookup = {
  ok: true as const,
  gameUserName: "Freddy",
  gameServerNumber: 1203,
  gameUserLevel: 50,
};

describe("tryPreApprovedMemberLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getLinkedMemberIds).mockResolvedValue(new Set());
  });

  it("returns the existing HQ commander when UID matches", async () => {
    vi.mocked(getHqMemberLinkForUser).mockResolvedValue({
      ashedMemberId: "m-1",
      memberDisplayName: "Freddy",
      gameUid: "123456789012",
    } as never);

    await expect(
      tryPreApprovedMemberLink({
        allianceId: "alliance-1",
        hqUserId: "hq-1",
        gameUid: "123456789012",
        lookup,
      }),
    ).resolves.toEqual({
      ok: true,
      target: {
        ashedMemberId: "m-1",
        memberDisplayName: "Freddy",
        gameUid: "123456789012",
        source: "hq_member_link",
      },
    });
    expect(findAcceptedClaimInviteForUser).not.toHaveBeenCalled();
  });

  it("does not pre-approve when HQ link UID differs", async () => {
    vi.mocked(getHqMemberLinkForUser).mockResolvedValue({
      ashedMemberId: "m-1",
      memberDisplayName: "Freddy",
      gameUid: "999999999999",
    } as never);
    vi.mocked(findAcceptedClaimInviteForUser).mockResolvedValue(null);

    await expect(
      tryPreApprovedMemberLink({
        allianceId: "alliance-1",
        hqUserId: "hq-1",
        gameUid: "123456789012",
        lookup,
      }),
    ).resolves.toEqual({ ok: false, reason: "not_preapproved" });
  });

  it("links via an accepted claim invite when Last War name matches", async () => {
    vi.mocked(getHqMemberLinkForUser).mockResolvedValue(null as never);
    vi.mocked(findAcceptedClaimInviteForUser).mockResolvedValue({
      inviteId: "inv-1",
      targetAshedMemberId: "m-claim",
    });
    const memberRows = [
      {
        ashedMemberId: "m-claim",
        currentName: "Freddy",
        previousNamesJson: [],
        status: "active",
      },
    ];
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            const rows = Promise.resolve(memberRows);
            return Object.assign(rows, {
              limit: vi.fn().mockResolvedValue(memberRows),
            });
          }),
        }),
      }),
    } as never);
    vi.mocked(linkHqMember).mockResolvedValue({
      ok: true,
      mode: "created",
      link: { id: "hq-link-1" } as never,
    });

    await expect(
      tryPreApprovedMemberLink({
        allianceId: "alliance-1",
        hqUserId: "hq-1",
        gameUid: "123456789012",
        lookup,
      }),
    ).resolves.toEqual({
      ok: true,
      target: {
        ashedMemberId: "m-claim",
        memberDisplayName: "Freddy",
        gameUid: "123456789012",
        source: "claim_invite",
      },
    });
    expect(linkHqMember).toHaveBeenCalledWith(
      expect.objectContaining({
        ashedMemberId: "m-claim",
        gameUid: "123456789012",
      }),
    );
  });

  it("surfaces claim conflicts when Last War name does not match the invite target", async () => {
    vi.mocked(getHqMemberLinkForUser).mockResolvedValue(null as never);
    vi.mocked(findAcceptedClaimInviteForUser).mockResolvedValue({
      inviteId: "inv-1",
      targetAshedMemberId: "m-claim",
    });
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            const rows = Promise.resolve([
              {
                ashedMemberId: "m-claim",
                currentName: "OtherName",
                previousNamesJson: [],
                status: "active",
              },
            ]);
            return Object.assign(rows, {
              limit: vi.fn().mockResolvedValue([
                {
                  ashedMemberId: "m-claim",
                  currentName: "OtherName",
                  previousNamesJson: [],
                  status: "active",
                },
              ]),
            });
          }),
        }),
      }),
    } as never);

    await expect(
      tryPreApprovedMemberLink({
        allianceId: "alliance-1",
        hqUserId: "hq-1",
        gameUid: "123456789012",
        lookup,
        requesterHandle: "discord-user",
      }),
    ).resolves.toEqual({ ok: false, reason: "claim_conflict" });

    expect(surfaceClaimConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        allianceId: "alliance-1",
        hqUserId: "hq-1",
        handle: "discord-user",
        reason: "target_mismatch",
      }),
    );
    expect(linkHqMember).not.toHaveBeenCalled();
  });
});
