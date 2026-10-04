import { describe, expect, it } from "vitest";

import { canRevokeOfficerAccess } from "@/lib/settings/team-officer-revoke.shared";
import type { RbacContext } from "@/lib/rbac/context";
import { ALLIANCE_ADMIN_PERMISSION } from "@/lib/rbac/constants";

function ctx(
  partial: Partial<RbacContext> & Pick<RbacContext, "roleName">,
): RbacContext {
  return {
    sessionId: "s1",
    hqUserId: "u1",
    email: "a@example.com",
    displayName: null,
    avatarUrl: null,
    currentAllianceId: "a1",
    roleName: partial.roleName,
    permissions: partial.permissions ?? new Set(),
    isPlatformMaintainer: partial.isPlatformMaintainer ?? false,
  };
}

describe("canRevokeOfficerAccess", () => {
  it("allows owner and maintainer", () => {
    expect(canRevokeOfficerAccess(ctx({ roleName: "owner" }))).toBe(true);
    expect(canRevokeOfficerAccess(ctx({ roleName: "maintainer" }))).toBe(true);
  });

  it("denies base officer", () => {
    expect(canRevokeOfficerAccess(ctx({ roleName: "officer" }))).toBe(false);
  });

  it("allows alliance admin permission", () => {
    expect(
      canRevokeOfficerAccess(
        ctx({
          roleName: "officer",
          permissions: new Set([ALLIANCE_ADMIN_PERMISSION]),
        }),
      ),
    ).toBe(true);
  });

  it("allows platform maintainer", () => {
    expect(
      canRevokeOfficerAccess(
        ctx({ roleName: "member", isPlatformMaintainer: true }),
      ),
    ).toBe(true);
  });
});
