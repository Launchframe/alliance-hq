import { describe, expect, it } from "vitest";

import { ROLE_IDS } from "@/lib/rbac/constants";

import {
  resolveRoleIdForClaimBoundRebind,
  resolveRoleIdForClaimPendingAccept,
} from "./claim-invite-elevation.shared";

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

describe("resolveRoleIdForClaimBoundRebind", () => {
  it("defers elevated roles on rebind when the bound commander is not linked yet", () => {
    // Pre-fix rebind passed invite.roleId raw into preserve_existing; with no
    // active membership that granted owner/officer before claim confirm.
    expect(
      resolveRoleIdForClaimBoundRebind({
        inviteRoleId: ROLE_IDS.owner,
        claimTargetAshedMemberId: "commander-r5",
        claimTargetHeldByAcceptor: false,
      }),
    ).toBe(ROLE_IDS.member);
  });

  it("allows the invite role once the acceptor holds the bound commander", () => {
    expect(
      resolveRoleIdForClaimBoundRebind({
        inviteRoleId: ROLE_IDS.owner,
        claimTargetAshedMemberId: "commander-r5",
        claimTargetHeldByAcceptor: true,
      }),
    ).toBe(ROLE_IDS.owner);
  });

  it("keeps non-claim invites as the invite role on rebind", () => {
    expect(
      resolveRoleIdForClaimBoundRebind({
        inviteRoleId: ROLE_IDS.officer,
        claimTargetAshedMemberId: null,
        claimTargetHeldByAcceptor: false,
      }),
    ).toBe(ROLE_IDS.officer);
  });
});
