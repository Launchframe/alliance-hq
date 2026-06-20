import { describe, expect, it } from "vitest";

import { ROLE_IDS } from "@/lib/rbac/constants";
import {
  isSystemRoleId,
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
});
