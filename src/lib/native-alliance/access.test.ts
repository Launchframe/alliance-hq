import { describe, expect, it } from "vitest";

import { rbacAllowsAshedConnect } from "@/lib/native-alliance/access";
import { ASHED_CONNECT_PERMISSION } from "@/lib/rbac/constants";

describe("rbacAllowsAshedConnect", () => {
  it("allows fresh sign-ins with hqUserId but no active membership", () => {
    expect(
      rbacAllowsAshedConnect(
        { isPlatformMaintainer: false, permissions: new Set() },
        false,
      ),
    ).toBe(true);
  });

  it("blocks active members whose role lacks ashed:connect", () => {
    expect(
      rbacAllowsAshedConnect(
        { isPlatformMaintainer: false, permissions: new Set() },
        true,
      ),
    ).toBe(false);
  });

  it("allows active members when role includes ashed:connect", () => {
    expect(
      rbacAllowsAshedConnect(
        {
          isPlatformMaintainer: false,
          permissions: new Set([ASHED_CONNECT_PERMISSION]),
        },
        true,
      ),
    ).toBe(true);
  });
});
