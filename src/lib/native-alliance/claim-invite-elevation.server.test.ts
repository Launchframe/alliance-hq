import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findAcceptedClaimInviteForUser,
  assignManualMembership,
  getDb,
} = vi.hoisted(() => ({
  findAcceptedClaimInviteForUser: vi.fn(),
  assignManualMembership: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("./invites", () => ({
  findAcceptedClaimInviteForUser,
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

describe("elevateMembershipAfterClaimLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assignManualMembership.mockResolvedValue("membership-1");
  });

  it("upgrades deferred member RBAC to the hybrid invite owner role after claim", async () => {
    findAcceptedClaimInviteForUser.mockResolvedValue({
      inviteId: "inv-1",
      targetAshedMemberId: "m-r5",
    });

    const inviteRoleLimit = vi
      .fn()
      .mockResolvedValue([{ roleId: ROLE_IDS.owner }]);
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

  it("is a no-op when there is no accepted claim invite", async () => {
    findAcceptedClaimInviteForUser.mockResolvedValue(null);
    const result = await elevateMembershipAfterClaimLink({
      allianceId: "a1",
      hqUserId: "bob",
    });
    expect(result).toEqual({ elevated: false, roleName: null });
    expect(assignManualMembership).not.toHaveBeenCalled();
  });
});
