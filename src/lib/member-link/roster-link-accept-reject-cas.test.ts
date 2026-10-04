import { beforeEach, describe, expect, it, vi } from "vitest";

const selectLimit = vi.fn();
const updateReturning = vi.fn();
const updateWhere = vi.fn(() => ({ returning: updateReturning }));
const updateSet = vi.fn(() => ({ where: updateWhere }));
const updateMock = vi.fn(() => ({ set: updateSet }));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: selectLimit,
        }),
      }),
    }),
    update: updateMock,
  }),
  schema: {
    hqRosterLinkRequests: {
      id: "hqRosterLinkRequests.id",
      status: "hqRosterLinkRequests.status",
      resolvedByHqUserId: "hqRosterLinkRequests.resolvedByHqUserId",
      createdMemberId: "hqRosterLinkRequests.createdMemberId",
      targetAshedMemberId: "hqRosterLinkRequests.targetAshedMemberId",
    },
    hqRosterLinkActionTokens: {
      requestId: "hqRosterLinkActionTokens.requestId",
      usedAt: "hqRosterLinkActionTokens.usedAt",
    },
    alliances: {
      id: "alliances.id",
      currentSeasonKey: "alliances.currentSeasonKey",
      gameServerNumber: "alliances.gameServerNumber",
      ownerHqUserId: "alliances.ownerHqUserId",
    },
    hqInvites: {
      allianceId: "hqInvites.allianceId",
      acceptedByHqUserId: "hqInvites.acceptedByHqUserId",
      kind: "hqInvites.kind",
      acceptedAt: "hqInvites.acceptedAt",
    },
    hqUsers: {
      id: "hqUsers.id",
      email: "hqUsers.email",
    },
  },
}));

vi.mock("@/lib/bff/audit", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/events/admin-alerts", () => ({
  emitMemberLinkUidTakenAlert: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/game-season/game-servers.server", () => ({
  resolveAllianceGameServerNumber: vi.fn(),
  linkAllianceToGameServer: vi.fn(),
}));

vi.mock("@/lib/game-season/sync", () => ({
  applySeasonSync: vi.fn(),
}));

vi.mock("@/lib/member-link/server-eligibility.server", () => ({
  resolveMemberLinkServerEligibilityForUid: vi.fn(),
}));

vi.mock("@/lib/native-alliance/operating-mode", () => ({
  isNativeAlliance: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/lastwar/sync-member-game-level.server", () => ({
  syncAllianceMemberGameLevelFromLastWar: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/member-link/repository.server", () => ({
  linkHqMember: vi.fn(),
  saveHqMemberLinkPending: vi.fn().mockResolvedValue(undefined),
  syncPrimaryGameUidFromHqMemberLink: vi.fn().mockResolvedValue(undefined),
  maybeSetOwnerMemberExternalId: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/member-link/roster-link-inbox.server", () => ({
  satisfyRosterLinkInboxItem: vi.fn().mockResolvedValue(undefined),
  materializeRosterLinkInboxItem: vi.fn(),
}));

vi.mock("@/lib/member-link/roster-link-owner-email.server", () => ({
  sendRosterLinkInviteeResolvedEmail: vi.fn().mockResolvedValue(undefined),
  sendRosterLinkOwnerApprovalEmail: vi.fn(),
  resolveAllianceOwnerEmail: vi.fn(),
}));

vi.mock("@/lib/member-link/roster-member-create.server", () => ({
  createNativeAllianceMemberForRosterLink: vi.fn(),
}));

vi.mock("@/lib/member-link/roster-link-resolve.server", () => ({
  bindDiscordRosterLinkRequest: vi.fn(),
  reconcileAllianceMemberForRosterLink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/member-link/translate.server", () => ({
  createMemberLinkTranslator: () => (key: string) => key,
}));

import {
  acceptRosterLinkRequest,
  rejectRosterLinkRequest,
} from "./roster-link-request.server";
import { linkHqMember } from "./repository.server";
import { createNativeAllianceMemberForRosterLink } from "./roster-member-create.server";

const pendingRequest = {
  id: "req-1",
  allianceId: "ally-1",
  hqUserId: "user-1",
  inviteId: null,
  origin: "web",
  discordUserId: null,
  discordUsername: null,
  reportedName: "Commander",
  gameUid: "1234567890121203",
  gameUserName: "Commander",
  gameServerNumber: 1203,
  gameUserLevel: null,
  suggestedTargetAshedMemberId: null,
  suggestionMethod: null,
  suggestedMatchedRosterName: null,
  targetAshedMemberId: null,
  createdMemberId: null,
  status: "pending",
  resolvedAt: null,
  resolvedByHqUserId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("roster-link accept/reject CAS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateMock.mockImplementation(() => ({ set: updateSet }));
    updateSet.mockImplementation(() => ({ where: updateWhere }));
    updateWhere.mockImplementation(() => ({ returning: updateReturning }));
  });

  it("rejects when accept already claimed the pending row (no link side effects)", async () => {
    selectLimit
      .mockResolvedValueOnce([pendingRequest])
      .mockResolvedValueOnce([{ ...pendingRequest, status: "accepted" }]);
    updateReturning.mockResolvedValueOnce([]);

    const result = await rejectRosterLinkRequest({
      requestId: "req-1",
      resolvedByHqUserId: "officer-2",
    });

    expect(result).toEqual({ ok: false, reason: "not_pending" });
    expect(linkHqMember).not.toHaveBeenCalled();
    expect(createNativeAllianceMemberForRosterLink).not.toHaveBeenCalled();
  });

  it("skips roster create/link when a concurrent reject already claimed the row", async () => {
    selectLimit
      .mockResolvedValueOnce([pendingRequest])
      .mockResolvedValueOnce([{ ...pendingRequest, status: "rejected" }]);
    updateReturning.mockResolvedValueOnce([]);

    const result = await acceptRosterLinkRequest({
      requestId: "req-1",
      resolvedByHqUserId: "officer-1",
      targetAshedMemberId: "member-existing",
    });

    expect(result).toEqual({ ok: false, reason: "not_pending" });
    expect(createNativeAllianceMemberForRosterLink).not.toHaveBeenCalled();
    expect(linkHqMember).not.toHaveBeenCalled();
  });

  it("claims pending→accepted before linking so a second accept cannot auto-create", async () => {
    const claimed = {
      ...pendingRequest,
      status: "accepted",
      resolvedAt: new Date(),
      resolvedByHqUserId: "officer-1",
    };
    selectLimit
      .mockResolvedValueOnce([pendingRequest])
      .mockResolvedValue([]); // invitee email lookup + any later selects
    updateReturning.mockResolvedValueOnce([claimed]);
    // Subsequent updates (member ids / tokens) resolve without returning.
    updateWhere.mockImplementation(() => {
      const chain = { returning: updateReturning };
      return Object.assign(Promise.resolve(undefined), chain);
    });

    vi.mocked(createNativeAllianceMemberForRosterLink).mockResolvedValue(
      "member-new",
    );
    vi.mocked(linkHqMember).mockResolvedValue({
      ok: true,
      mode: "created",
      link: {
        id: "link-1",
        allianceId: "ally-1",
        hqUserId: "user-1",
        ashedMemberId: "member-new",
        memberDisplayName: "Commander",
        gameUid: "1234567890121203",
        linkedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const result = await acceptRosterLinkRequest({
      requestId: "req-1",
      resolvedByHqUserId: "officer-1",
    });

    expect(result).toEqual({ ok: true, memberName: "Commander" });
    expect(updateMock).toHaveBeenCalled();
    expect(createNativeAllianceMemberForRosterLink).toHaveBeenCalledTimes(1);
    expect(linkHqMember).toHaveBeenCalledWith(
      expect.objectContaining({
        ashedMemberId: "member-new",
        hqUserId: "user-1",
      }),
    );
  });
});
