import { describe, expect, it } from "vitest";

import {
  destinationById,
  destinationIsVisible,
  findActiveDestination,
  navLinkActive,
  type NavVisibilityOptions,
} from "@/lib/nav/registry";

function visibility(
  overrides: Partial<NavVisibilityOptions> = {},
): NavVisibilityOptions {
  return {
    permissions: new Set<string>(),
    hasAllianceMemberLink: true,
    operatingMode: "ashed",
    canUseAshedEmbeds: true,
    showAshedPages: true,
    showVideoQueue: false,
    showVideoJobsOps: false,
    showVideoProcessorsNav: false,
    showTeamAccess: false,
    showAdminPortal: false,
    isPlatformMaintainer: false,
    ...overrides,
  };
}

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

  it("follows alliance settings hub rules for child routes", () => {
    expect(findActiveDestination("/settings/discord", "app")?.id).toBe(
      "alliance-settings",
    );
    expect(findActiveDestination("/settings/hotkeys", "app")).toBeUndefined();
    expect(findActiveDestination("/settings/account", "app")).toBeUndefined();
    expect(
      findActiveDestination("/settings/vs-compliance", "app"),
    ).toBeUndefined();
    expect(
      findActiveDestination("/alliance/lfgo/settings", "app"),
    ).toBeUndefined();
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

    expect(
      destinationIsVisible(destination!, visibility({ showAshedPages: false })),
    ).toBe(false);
  });

  it("hides ashed-only destinations for native alliances", () => {
    const destination = destinationById("waiting-list");
    expect(destination?.surface).toBe("ashed-only");
    expect(
      destinationIsVisible(
        destination!,
        visibility({ operatingMode: "native", canUseAshedEmbeds: false }),
      ),
    ).toBe(false);
  });

  it("keeps hybrid HQ pages visible for native alliances", () => {
    const vs = destinationById("vs-performance");
    expect(vs?.surface).toBe("hybrid");
    expect(
      destinationIsVisible(
        vs!,
        visibility({
          permissions: new Set(["scores:read"]),
          operatingMode: "native",
          canUseAshedEmbeds: false,
          showAshedPages: false,
        }),
      ),
    ).toBe(true);

    const data = destinationById("data-management");
    expect(data?.surface).toBe("hybrid");
    expect(
      destinationIsVisible(
        data!,
        visibility({
          permissions: new Set(["data:read"]),
          operatingMode: "native",
          canUseAshedEmbeds: false,
        }),
      ),
    ).toBe(true);
  });

  it("hides admin destinations without hq:admin", () => {
    const destination = destinationById("admin-uid-inspector");
    expect(destination?.context).toBe("admin");
    expect(destinationIsVisible(destination!, visibility())).toBe(false);
    expect(
      destinationIsVisible(
        destination!,
        visibility({
          permissions: new Set(["hq:admin"]),
          isPlatformMaintainer: true,
        }),
      ),
    ).toBe(true);
  });
});
