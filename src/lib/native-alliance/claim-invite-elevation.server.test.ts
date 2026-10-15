import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findAcceptedClaimInviteForUser,
  assignManualMembership,
  assertHybridClaimInviteRankAtAccept,
  getDb,
} = vi.hoisted(() => ({
  findAcceptedClaimInviteForUser: vi.fn(),
  assignManualMembership: vi.fn(),
  assertHybridClaimInviteRankAtAccept: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("./invites", () => ({
  findAcceptedClaimInviteForUser,
}));

vi.mock("./invite-accept-rank.server", () => ({
  assertHybridClaimInviteRankAtAccept,
}));

vi.mock("@/lib/rbac/admin-users", () => ({
  assignManualMembership,
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb,
  };
});

import { ROLE_IDS } from "@/lib/rbac/constants";

import { elevateMembershipAfterClaimLink } from "./claim-invite-elevation.server";

/** Mirrors HYBRID_OWNER_RANK_STALE_MESSAGE (module is mocked above). */
const HYBRID_OWNER_RANK_STALE_MESSAGE =
  "Owner invite requires the claim commander to still be in-game R5.";

describe("elevateMembershipAfterClaimLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assignManualMembership.mockResolvedValue("membership-1");
    assertHybridClaimInviteRankAtAccept.mockResolvedValue(undefined);
  });

  it("upgrades deferred member RBAC to the hybrid invite owner role after claim", async () => {
    findAcceptedClaimInviteForUser.mockResolvedValue({
      inviteId: "inv-1",
      targetAshedMemberId: "m-r5",
    });

    const inviteRoleLimit = vi.fn().mockResolvedValue([
      { roleId: ROLE_IDS.owner, invitedByHqUserId: "officer-1" },
    ]);
    const membershipLimit = vi
      .fn()
      .mockResolvedValue([{ roleId: ROLE_IDS.member, status: "active" }]);
    const allianceLimit = vi
      .fn()
      .mockResolvedValue([{ ownerEmail: "prev@example.com" }]);
    const updateSet = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });

    let selectCall = 0;
    getDb.mockReturnValue({
      select: vi.fn(() => {
        selectCall += 1;
        if (selectCall === 1) {
          return {
            from: () => ({
              where: () => ({
                limit: inviteRoleLimit,
              }),
            }),
          };
        }
        if (selectCall === 2) {
          return {
            from: () => ({
              where: () => ({
                limit: membershipLimit,
              }),
            }),
          };
        }
        return {
          from: () => ({
            where: () => ({
              limit: allianceLimit,
            }),
          }),
        };
      }),
      update: vi.fn(() => ({ set: updateSet })),
    });

    const result = await elevateMembershipAfterClaimLink({
      allianceId: "a1",
      hqUserId: "bob",
      ownerEmail: "bob@example.com",
    });

    expect(assertHybridClaimInviteRankAtAccept).toHaveBeenCalledWith({
      allianceId: "a1",
      roleId: ROLE_IDS.owner,
      targetAshedMemberId: "m-r5",
      invitedByHqUserId: "officer-1",
    });
    expect(result).toEqual({ elevated: true, roleName: "owner" });
    expect(assignManualMembership).toHaveBeenCalledWith({
      hqUserId: "bob",
      allianceId: "a1",
      roleId: ROLE_IDS.owner,
    });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerHqUserId: "bob",
        ownerEmail: "bob@example.com",
      }),
    );
  });

  it("BUG REPRO: refuses owner elevation when commander was demoted after accept", async () => {
    // Accept-time rank check passed while R5; #754 deferred RBAC to claim
    // confirm. Without a re-check here, demotion to R4 still granted owner.
    findAcceptedClaimInviteForUser.mockResolvedValue({
      inviteId: "inv-1",
      targetAshedMemberId: "m-was-r5",
    });

    getDb.mockReturnValue({
      select: vi.fn(() => ({
        from: () => ({
          where: () => ({
            limit: vi.fn().mockResolvedValue([
              { roleId: ROLE_IDS.owner, invitedByHqUserId: "issuer-1" },
            ]),
          }),
        }),
      })),
    });

    assertHybridClaimInviteRankAtAccept.mockRejectedValue(
      new Error(HYBRID_OWNER_RANK_STALE_MESSAGE),
    );

    await expect(
      elevateMembershipAfterClaimLink({
        allianceId: "a1",
        hqUserId: "bob",
      }),
    ).rejects.toThrow(HYBRID_OWNER_RANK_STALE_MESSAGE);

    expect(assertHybridClaimInviteRankAtAccept).toHaveBeenCalledWith({
      allianceId: "a1",
      roleId: ROLE_IDS.owner,
      targetAshedMemberId: "m-was-r5",
      invitedByHqUserId: "issuer-1",
    });
    expect(assignManualMembership).not.toHaveBeenCalled();
  });

  it("is a no-op when there is no accepted claim invite", async () => {
    findAcceptedClaimInviteForUser.mockResolvedValue(null);
    const result = await elevateMembershipAfterClaimLink({
      allianceId: "a1",
      hqUserId: "bob",
    });
    expect(result).toEqual({ elevated: false, roleName: null });
    expect(assertHybridClaimInviteRankAtAccept).not.toHaveBeenCalled();
    expect(assignManualMembership).not.toHaveBeenCalled();
  });
});
