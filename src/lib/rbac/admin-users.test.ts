import { describe, expect, it } from "vitest";

import { canDemotePlatformMaintainer } from "@/lib/rbac/admin-users";

describe("canDemotePlatformMaintainer", () => {
  it("allows demotion when multiple maintainers exist", () => {
    expect(canDemotePlatformMaintainer(true, 2)).toBe(true);
  });

  it("blocks demotion of the last maintainer", () => {
    expect(canDemotePlatformMaintainer(true, 1)).toBe(false);
  });

  it("allows toggling non-maintainers off", () => {
    expect(canDemotePlatformMaintainer(false, 1)).toBe(true);
  });
});
