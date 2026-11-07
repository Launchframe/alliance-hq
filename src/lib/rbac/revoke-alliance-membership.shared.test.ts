import { describe, expect, it } from "vitest";

import {
  decideAllianceMembershipRevoke,
  leaveBlockedReasonForMembership,
  sessionAllianceAfterRevoke,
} from "./revoke-alliance-membership.shared";

describe("decideAllianceMembershipRevoke", () => {
  it("refuses to revoke the last active owner", () => {
    expect(
      decideAllianceMembershipRevoke({
        mode: "admin",
        targetIsOwner: true,
        activeOwnerCount: 1,
        activeMembershipCount: 2,
        otherAllianceIds: ["other"],
      }),
    ).toEqual({ ok: false, code: "last_owner" });
  });

  it("refuses self-leave when it is the only active membership", () => {
    expect(
      decideAllianceMembershipRevoke({
        mode: "self",
        targetIsOwner: false,
        activeOwnerCount: 1,
        activeMembershipCount: 1,
        otherAllianceIds: [],
      }),
    ).toEqual({ ok: false, code: "only_membership" });
  });

  it("lets a member leave a stale alliance and points the session at the one that remains", () => {
    expect(
      decideAllianceMembershipRevoke({
        mode: "self",
        targetIsOwner: false,
        activeOwnerCount: 1,
        activeMembershipCount: 2,
        otherAllianceIds: ["caos"],
      }),
    ).toEqual({ ok: true, nextAllianceId: "caos" });
    expect(
      sessionAllianceAfterRevoke({
        sessionAllianceId: "roar",
        revokedAllianceId: "roar",
        nextAllianceId: "caos",
      }),
    ).toBe("caos");
  });

  it("keeps the session alliance when the revoked membership is not current", () => {
    expect(
      sessionAllianceAfterRevoke({
        sessionAllianceId: "caos",
        revokedAllianceId: "roar",
        nextAllianceId: "caos",
      }),
    ).toBe("caos");
  });

  it("lets an admin remove someone's only membership", () => {
    expect(
      decideAllianceMembershipRevoke({
        mode: "admin",
        targetIsOwner: false,
        activeOwnerCount: 1,
        activeMembershipCount: 1,
        otherAllianceIds: [],
      }),
    ).toEqual({ ok: true, nextAllianceId: null });
    expect(
      sessionAllianceAfterRevoke({
        sessionAllianceId: "roar",
        revokedAllianceId: "roar",
        nextAllianceId: null,
      }),
    ).toBeNull();
  });
});

describe("leaveBlockedReasonForMembership", () => {
  it("blocks the sole owner and lets other roles leave", () => {
    expect(
      leaveBlockedReasonForMembership({ roleName: "owner", activeOwnerCount: 1 }),
    ).toBe("last_owner");
    expect(
      leaveBlockedReasonForMembership({ roleName: "owner", activeOwnerCount: 2 }),
    ).toBeNull();
    expect(
      leaveBlockedReasonForMembership({ roleName: "officer", activeOwnerCount: 1 }),
    ).toBeNull();
  });
});
