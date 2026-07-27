import { describe, expect, it } from "vitest";

import { ROLE_IDS } from "@/lib/rbac/constants";

import { resolveProvisionRoleId } from "./provision-membership";

describe("resolveProvisionRoleId", () => {
  it("applies invite role when no existing membership", () => {
    expect(
      resolveProvisionRoleId({
        inviteRoleId: ROLE_IDS.member,
        existingRoleId: null,
        existingStatus: null,
        rolePolicy: "never_demote",
      }),
    ).toBe(ROLE_IDS.member);
  });

  it("applies invite role when existing membership is revoked", () => {
    expect(
      resolveProvisionRoleId({
        inviteRoleId: ROLE_IDS.officer,
        existingRoleId: ROLE_IDS.member,
        existingStatus: "revoked",
        rolePolicy: "preserve_existing",
      }),
    ).toBe(ROLE_IDS.officer);
  });

  it("never demotes an active officer who accepts a member/claim invite", () => {
    expect(
      resolveProvisionRoleId({
        inviteRoleId: ROLE_IDS.member,
        existingRoleId: ROLE_IDS.officer,
        existingStatus: "active",
        rolePolicy: "never_demote",
      }),
    ).toBe(ROLE_IDS.officer);
  });

  it("still upgrades an active member who accepts an officer invite", () => {
    expect(
      resolveProvisionRoleId({
        inviteRoleId: ROLE_IDS.officer,
        existingRoleId: ROLE_IDS.member,
        existingStatus: "active",
        rolePolicy: "never_demote",
      }),
    ).toBe(ROLE_IDS.officer);
  });

  it("preserves active role on rebind / join-code re-redeem (no re-escalation)", () => {
    expect(
      resolveProvisionRoleId({
        inviteRoleId: ROLE_IDS.officer,
        existingRoleId: ROLE_IDS.member,
        existingStatus: "active",
        rolePolicy: "preserve_existing",
      }),
    ).toBe(ROLE_IDS.member);
  });

  it("preserves active officer on member invite rebind", () => {
    expect(
      resolveProvisionRoleId({
        inviteRoleId: ROLE_IDS.member,
        existingRoleId: ROLE_IDS.officer,
        existingStatus: "active",
        rolePolicy: "preserve_existing",
      }),
    ).toBe(ROLE_IDS.officer);
  });
});
