import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getHqMemberLinkByAllianceAndMember,
  getLinkedMemberIds,
  getDiscordLinkByAllianceAndMember,
  getDiscordHqLink,
  provisionAllianceMembership,
  getDb,
  auditInviteAccepted,
  isCommanderReservedByPendingClaim,
} = vi.hoisted(() => ({
  isCommanderReservedByPendingClaim: vi.fn(),
  getHqMemberLinkByAllianceAndMember: vi.fn(),
  getLinkedMemberIds: vi.fn(),
  getDiscordLinkByAllianceAndMember: vi.fn(),
  getDiscordHqLink: vi.fn(),
  provisionAllianceMembership: vi.fn(),
  getDb: vi.fn(),
  auditInviteAccepted: vi.fn(),
}));

vi.mock("@/lib/member-link/repository.server", () => ({
  getHqMemberLinkByAllianceAndMember,
}));

vi.mock("@/lib/vr/repository", () => ({
  getLinkedMemberIds,
  getDiscordLinkByAllianceAndMember,
  getDiscordHqLink,
}));

vi.mock("./invite-accept-rank.server", () => ({ assertHybridClaimInviteRankAtAccept: vi.fn().mockResolvedValue(undefined) }));

vi.mock("./provision-membership", () => ({
  provisionAllianceMembership,
}));

vi.mock("./invite-accept-rank.server", () => ({
  assertHybridClaimInviteRankAtAccept: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./claim-seat-reservation.server", () => ({
  isCommanderReservedByPendingClaim,
}));

vi.mock("@/lib/onboarding/onboarding-audit.server", () => ({
  auditInviteAccepted,
}));

vi.mock("./invite-accept-rank.server", () => ({
  assertHybridClaimInviteRankAtAccept: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb,
  };
});

import { ROLE_IDS } from "@/lib/rbac/constants";

import {
  acceptHqInvite,
  CommanderClaimInviteError,
  rebindAcceptedInviteSession,
} from "./invites";

function inviteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-1",
    allianceId: "a1",
    roleId: "role-owner",
    kind: "email",
    email: "bob@example.com",
    tokenHash: "hash",
    targetAshedMemberId: "m-r5",
    passphraseHash: null,
    passphraseConsumedAt: null,
    acceptedAt: null,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    redirectPath: "/onboard",
    ...overrides,
  };
}

describe("acceptHqInvite claim occupancy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLinkedMemberIds.mockResolvedValue(new Set());
    getDiscordLinkByAllianceAndMember.mockResolvedValue(null as never);
    getDiscordHqLink.mockResolvedValue(null as never);
    provisionAllianceMembership.mockResolvedValue({
      allianceId: "a1",
      allianceTag: "TAG",
      allianceName: "Test",
      hqUserId: "bob",
      roleName: "owner",
    });
    auditInviteAccepted.mockResolvedValue(undefined);
    isCommanderReservedByPendingClaim.mockResolvedValue(false);
  });

  it("fail-closes before provision when another HQ user holds the claim seat", async () => {
    const invite = inviteRow();
    const update = vi.fn();
    getDb.mockReturnValue({
      select: vi.fn(() => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([invite]),
          }),
        }),
      })),
      update,
      delete: vi.fn(),
    });

    getHqMemberLinkByAllianceAndMember.mockResolvedValue({
      hqUserId: "alice",
      ashedMemberId: "m-r5",
    });

    await expect(
      acceptHqInvite({
        token: "tok",
        sessionId: "sess-1",
        hqUserId: "bob",
        userEmail: "bob@example.com",
        email: "bob@example.com",
      }),
    ).rejects.toMatchObject({
      name: "CommanderClaimInviteError",
      code: "commander_already_claimed",
    } satisfies Partial<CommanderClaimInviteError>);

    expect(update).not.toHaveBeenCalled();
    expect(provisionAllianceMembership).not.toHaveBeenCalled();
  });

  it("defers elevated RBAC to member while the claim seat is still free", async () => {
    const invite = inviteRow();
    const updateSet = vi.fn().mockReturnValue({
      where: () => ({
        returning: () => Promise.resolve([{ id: "inv-1" }]),
      }),
    });
    getDb.mockReturnValue({
      select: vi.fn(() => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([invite]),
          }),
        }),
      })),
      update: vi.fn(() => ({ set: updateSet })),
      delete: vi.fn(() => ({
        where: () => Promise.resolve(undefined),
      })),
    });

    getHqMemberLinkByAllianceAndMember.mockResolvedValue(null);

    const result = await acceptHqInvite({
      token: "any-token",
      sessionId: "sess-1",
      hqUserId: "bob",
      userEmail: "bob@example.com",
      email: "bob@example.com",
    });

    expect(provisionAllianceMembership).toHaveBeenCalledWith(
      expect.objectContaining({
        roleId: ROLE_IDS.member,
        ownerEmail: null,
      }),
    );
    expect(result.targetAshedMemberId).toBe("m-r5");
  });

  it("soft-clears claim and still provisions when the acceptor already holds the seat", async () => {
    const invite = inviteRow();
    const updateSet = vi.fn().mockReturnValue({
      where: () => ({
        returning: () => Promise.resolve([{ id: "inv-1" }]),
      }),
    });
    getDb.mockReturnValue({
      select: vi.fn(() => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([invite]),
          }),
        }),
      })),
      update: vi.fn(() => ({ set: updateSet })),
      delete: vi.fn(() => ({
        where: () => Promise.resolve(undefined),
      })),
    });

    getHqMemberLinkByAllianceAndMember.mockResolvedValue({
      hqUserId: "bob",
      ashedMemberId: "m-r5",
    });

    const result = await acceptHqInvite({
      token: "any-token",
      sessionId: "sess-1",
      hqUserId: "bob",
      userEmail: "bob@example.com",
      email: "bob@example.com",
    });

    expect(provisionAllianceMembership).toHaveBeenCalledWith(
      expect.objectContaining({
        roleId: ROLE_IDS.owner,
        ownerEmail: "bob@example.com",
      }),
    );
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        targetAshedMemberId: null,
      }),
    );
    expect(result.targetAshedMemberId).toBeNull();
  });

  it("fail-closes when another acceptor already reserved the free claim seat", async () => {
    const invite = inviteRow();
    const update = vi.fn();
    getDb.mockReturnValue({
      select: vi.fn(() => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([invite]),
          }),
        }),
      })),
      update,
      delete: vi.fn(),
    });
    getHqMemberLinkByAllianceAndMember.mockResolvedValue(null);
    isCommanderReservedByPendingClaim.mockResolvedValue(true);

    await expect(
      acceptHqInvite({
        token: "tok",
        sessionId: "sess-1",
        hqUserId: "bob",
        userEmail: "bob@example.com",
        email: "bob@example.com",
      }),
    ).rejects.toMatchObject({ code: "commander_already_claimed" });

    expect(isCommanderReservedByPendingClaim).toHaveBeenCalledWith({
      allianceId: "a1",
      ashedMemberId: "m-r5",
      allowedHqUserId: "bob",
    });
    expect(update).not.toHaveBeenCalled();
    expect(provisionAllianceMembership).not.toHaveBeenCalled();
  });
});

describe("rebindAcceptedInviteSession claim deferral", () => {
  function mockAcceptedInvite() {
    const invite = inviteRow({
      acceptedAt: new Date(),
      acceptedByHqUserId: "bob",
    });
    const limit = vi
      .fn()
      .mockResolvedValueOnce([invite])
      .mockResolvedValueOnce([{ id: "a1", tag: "TAG" }]);
    getDb.mockReturnValue({
      select: vi.fn(() => ({
        from: () => ({
          where: () => ({ limit }),
        }),
      })),
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    provisionAllianceMembership.mockResolvedValue({
      allianceId: "a1",
      allianceTag: "TAG",
      allianceName: "Test",
      hqUserId: "bob",
      roleName: "member",
    });
  });

  it("keeps the invite role deferred while the claim is still pending", async () => {
    mockAcceptedInvite();
    getHqMemberLinkByAllianceAndMember.mockResolvedValue(null);

    await rebindAcceptedInviteSession({
      token: "tok",
      sessionId: "sess-2",
      hqUserId: "bob",
      userEmail: "bob@example.com",
    });

    expect(provisionAllianceMembership).toHaveBeenCalledWith(
      expect.objectContaining({
        roleId: ROLE_IDS.member,
        rolePolicy: "preserve_existing",
        ownerEmail: null,
      }),
    );
  });

  it("uses the invite role once the acceptor holds the claim seat", async () => {
    mockAcceptedInvite();
    getHqMemberLinkByAllianceAndMember.mockResolvedValue({
      hqUserId: "bob",
      ashedMemberId: "m-r5",
    });

    await rebindAcceptedInviteSession({
      token: "tok",
      sessionId: "sess-2",
      hqUserId: "bob",
      userEmail: "bob@example.com",
    });

    expect(provisionAllianceMembership).toHaveBeenCalledWith(
      expect.objectContaining({
        roleId: "role-owner",
        rolePolicy: "preserve_existing",
      }),
    );
  });
});
