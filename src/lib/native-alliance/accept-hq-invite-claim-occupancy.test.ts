import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getHqMemberLinkByAllianceAndMember,
  getLinkedMemberIds,
  getDiscordLinkByAllianceAndMember,
  getDiscordHqLink,
  provisionAllianceMembership,
  getDb,
  auditInviteAccepted,
} = vi.hoisted(() => ({
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

import {
  acceptHqInvite,
  CommanderClaimInviteError,
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

    expect(provisionAllianceMembership).toHaveBeenCalledOnce();
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        targetAshedMemberId: null,
      }),
    );
    expect(result.targetAshedMemberId).toBeNull();
  });
});
