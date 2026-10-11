import { describe, expect, it } from "vitest";

import {
  destinationIsVisible,
  findActiveDestination,
  navLinkActive,
} from "@/lib/nav/registry";

describe("findActiveDestination", () => {
  it("prefers admin context on /admin", () => {
    const admin = findActiveDestination("/admin", "admin");
    expect(admin?.id).toBe("admin-overview");
    expect(admin?.context).toBe("admin");
  });

  it("resolves app admin portal on /admin in app context", () => {
    const app = findActiveDestination("/admin", "app");
    expect(app?.id).toBe("admin-portal");
    expect(app?.context).toBe("app");
  });

  it("matches commanders under members via navLinkActive", () => {
    const destination = findActiveDestination("/commanders/abc", "app");
    expect(destination?.id).toBe("members");
  });

  it("does not treat /settings/team as /settings only", () => {
    expect(findActiveDestination("/settings/team", "app")?.href).toBe(
      "/settings/team",
    );
  });
});

describe("navLinkActive", () => {
  it("treats /admin as exact match only", () => {
    expect(navLinkActive("/admin/inbox", "/admin")).toBe(false);
    expect(navLinkActive("/admin", "/admin")).toBe(true);
  });
});

describe("destinationIsVisible", () => {
  it("hides ashed-only destinations when showAshedPages is false", () => {
    const destination = findActiveDestination("/waiting-list", "app");
    expect(destination?.surface).toBe("ashed-only");

    const visible = destinationIsVisible(destination!, {
      permissions: new Set(["members:read"]),
      hasAllianceMemberLink: true,
      operatingMode: "ashed",
      canUseAshedEmbeds: true,
      showAshedPages: false,
      showVideoQueue: false,
      showVideoJobsOps: false,
      showVideoProcessorsNav: false,
      showTeamAccess: false,
      showAdminPortal: false,
      isPlatformMaintainer: false,
    });
    expect(visible).toBe(false);
  });
});
