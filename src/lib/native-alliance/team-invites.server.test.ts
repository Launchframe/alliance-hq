import { describe, expect, it } from "vitest";

import {
  assertInviteRoleAllowed,
  assignableInviteRolesForContext,
  canManageTeamInvites,
} from "@/lib/native-alliance/team-invites.server";
import type { RbacContext } from "@/lib/rbac/context";

function makeCtx(partial: Partial<RbacContext>): RbacContext {
  return {
    sessionId: "s1",
    hqUserId: "u1",
    email: "officer@test.com",
    displayName: null,
    avatarUrl: null,
    isPlatformMaintainer: false,
    currentAllianceId: "a1",
    roleName: "officer",
    permissions: new Set(["members:write"]),
    ...partial,
  };
}

describe("team invite access", () => {
  it("allows officers to invite member roles only", () => {
    const ctx = makeCtx({ roleName: "officer" });
    expect(canManageTeamInvites(ctx)).toBe(true);
    expect(assignableInviteRolesForContext(ctx)).toEqual([
      "data_entry",
      "viewer",
      "member",
    ]);
    expect(() => assertInviteRoleAllowed(ctx, "member")).not.toThrow();
    expect(() => assertInviteRoleAllowed(ctx, "officer")).toThrow(
      "You cannot assign that invite role.",
    );
  });

  it("allows alliance admins to invite officers", () => {
    const ctx = makeCtx({
      roleName: "owner",
      permissions: new Set(["alliance:admin", "members:write"]),
    });
    expect(assignableInviteRolesForContext(ctx)).toEqual([
      "officer",
      "data_entry",
      "viewer",
      "member",
    ]);
    expect(() => assertInviteRoleAllowed(ctx, "officer")).not.toThrow();
  });

  it("blocks owner role assignment for alliance leaders", () => {
    const ctx = makeCtx({
      roleName: "owner",
      permissions: new Set(["alliance:admin"]),
    });
    expect(() => assertInviteRoleAllowed(ctx, "owner")).toThrow(
      "Owner invites require a platform maintainer.",
    );
  });

  it("denies viewers from managing invites", () => {
    const ctx = makeCtx({
      roleName: "viewer",
      permissions: new Set(["members:read"]),
    });
    expect(canManageTeamInvites(ctx)).toBe(false);
  });
});
