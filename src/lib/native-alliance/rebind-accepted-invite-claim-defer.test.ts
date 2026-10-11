import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getDb,
  provisionAllianceMembership,
  getHqMemberLinkForUser,
  getHqMemberLinkByAllianceAndMember,
} = vi.hoisted(() => ({
  getDb: vi.fn(),
  provisionAllianceMembership: vi.fn(),
  getHqMemberLinkForUser: vi.fn(),
  getHqMemberLinkByAllianceAndMember: vi.fn(),
}));

vi.mock("./provision-membership", () => ({
  provisionAllianceMembership,
}));

vi.mock("@/lib/member-link/repository.server", () => ({
  getHqMemberLinkForUser,
  getHqMemberLinkByAllianceAndMember,
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb,
  };
});

import { ROLE_IDS } from "@/lib/rbac/constants";

import { rebindAcceptedInviteSession } from "./invites";

function acceptedOwnerClaimInvite(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "inv-1",
    allianceId: "a1",
    roleId: ROLE_IDS.owner,
    kind: "email",
    email: "bob@example.com",
    tokenHash: "hash",
    targetAshedMemberId: "m-r5",
    acceptedAt: new Date("2026-10-11T12:00:00.000Z"),
    acceptedByHqUserId: "bob",
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    redirectPath: "/onboard",
    ...overrides,
  };
}

describe("rebindAcceptedInviteSession claim-bound RBAC defer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    provisionAllianceMembership.mockResolvedValue({
      allianceId: "a1",
      allianceTag: "TAG",
      allianceName: "Test",
      hqUserId: "bob",
      roleName: "member",
    });
    getHqMemberLinkForUser.mockResolvedValue(null);
  });

  it("provisions member (not owner) when claim is still pending and no membership exists", async () => {
    const invite = acceptedOwnerClaimInvite();
    const alliance = { id: "a1", tag: "TAG", name: "Test" };
    const selectResults = [[invite], [alliance]];
    getDb.mockReturnValue({
      select: vi.fn(() => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(selectResults.shift() ?? []),
          }),
        }),
      })),
    });

    await rebindAcceptedInviteSession({
      token: "invite-token",
      sessionId: "sess-1",
      hqUserId: "bob",
      userEmail: "bob@example.com",
    });

    expect(getHqMemberLinkForUser).toHaveBeenCalledWith("a1", "bob");
    expect(provisionAllianceMembership).toHaveBeenCalledWith(
      expect.objectContaining({
        roleId: ROLE_IDS.member,
        rolePolicy: "preserve_existing",
        ownerEmail: null,
      }),
    );
  });

  it("keeps the invite owner role target once the acceptor has linked", async () => {
    const invite = acceptedOwnerClaimInvite();
    const alliance = { id: "a1", tag: "TAG", name: "Test" };
    const selectResults = [[invite], [alliance]];
    getHqMemberLinkForUser.mockResolvedValue({
      hqUserId: "bob",
      ashedMemberId: "m-r5",
    });
    getDb.mockReturnValue({
      select: vi.fn(() => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(selectResults.shift() ?? []),
          }),
        }),
      })),
    });

    await rebindAcceptedInviteSession({
      token: "invite-token",
      sessionId: "sess-1",
      hqUserId: "bob",
      userEmail: "bob@example.com",
    });

    expect(provisionAllianceMembership).toHaveBeenCalledWith(
      expect.objectContaining({
        roleId: ROLE_IDS.owner,
        rolePolicy: "preserve_existing",
        ownerEmail: "bob@example.com",
      }),
    );
  });
});
