import { describe, expect, it } from "vitest";

import { ROLE_IDS } from "@/lib/rbac/constants";

import { resolveRoleIdForClaimPendingAccept } from "./claim-invite-elevation.shared";

describe("resolveRoleIdForClaimPendingAccept", () => {
  it("defers elevated invite roles while a claim seat is still pending", () => {
    expect(
      resolveRoleIdForClaimPendingAccept({
        inviteRoleId: ROLE_IDS.owner,
        pendingClaimTargetId: "commander-r5",
      }),
    ).toBe(ROLE_IDS.member);

    expect(
      resolveRoleIdForClaimPendingAccept({
        inviteRoleId: ROLE_IDS.officer,
        pendingClaimTargetId: "commander-r4",
      }),
    ).toBe(ROLE_IDS.member);
  });

  it("keeps the invite role when the claim seat is already resolved", () => {
    expect(
      resolveRoleIdForClaimPendingAccept({
        inviteRoleId: ROLE_IDS.owner,
        pendingClaimTargetId: null,
      }),
    ).toBe(ROLE_IDS.owner);

    expect(
      resolveRoleIdForClaimPendingAccept({
        inviteRoleId: ROLE_IDS.officer,
        pendingClaimTargetId: "",
      }),
    ).toBe(ROLE_IDS.officer);
  });

  it("keeps member claim invites as member whether or not a target is pending", () => {
    expect(
      resolveRoleIdForClaimPendingAccept({
        inviteRoleId: ROLE_IDS.member,
        pendingClaimTargetId: "commander-1",
      }),
    ).toBe(ROLE_IDS.member);
  });
});
