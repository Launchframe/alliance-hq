import { describe, expect, it } from "vitest";

import { ASHED_CONNECT_PERMISSION, HQ_PERMISSIONS, ROLE_IDS } from "@/lib/rbac/constants";
import {
  isSystemRoleId,
  shouldUpgradeSystemRole,
  systemRoleIdForName,
  systemRoleNameForId,
} from "@/lib/rbac/system-roles";

describe("system-roles", () => {
  it("recognizes seeded system role ids", () => {
    expect(isSystemRoleId(ROLE_IDS.maintainer)).toBe(true);
    expect(isSystemRoleId("role-unknown")).toBe(false);
  });

  it("maps role names and ids", () => {
    expect(systemRoleIdForName("owner")).toBe("role-owner");
    expect(systemRoleNameForId("role-viewer")).toBe("viewer");
    expect(systemRoleNameForId("role-member")).toBe("member");
    expect(systemRoleNameForId("missing")).toBeNull();
  });

  it("ASHED_CONNECT_PERMISSION is declared in HQ_PERMISSIONS", () => {
    const ids = HQ_PERMISSIONS.map((p) => p.id);
    expect(ids).toContain(ASHED_CONNECT_PERMISSION);
  });

  it("shouldUpgradeSystemRole ranks roles for Ashed sync promotion", () => {
    expect(shouldUpgradeSystemRole("member", "officer")).toBe(true);
    expect(shouldUpgradeSystemRole("officer", "member")).toBe(false);
    expect(shouldUpgradeSystemRole("officer", "maintainer")).toBe(true);
  });
});
