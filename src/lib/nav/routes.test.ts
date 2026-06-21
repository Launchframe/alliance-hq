import { describe, expect, it } from "vitest";

import {
  ashedUrlForPath,
  filterNavGroupsForPermissions,
  isNavActive,
  legacyAshedRedirect,
  navLinkActive,
  NAV_GROUPS,
  resolveAshedPath,
  resolveIframePage,
  trainwreckCase,
} from "@/lib/nav/routes";

describe("trainwreckCase", () => {
  it("removes hyphens from HQ paths", () => {
    expect(trainwreckCase("/desert-storm")).toBe("/desertstorm");
    expect(trainwreckCase("/waiting-list")).toBe("/waitinglist");
  });
});

describe("resolveAshedPath", () => {
  it("returns trainwreck path for iframe pages", () => {
    expect(
      resolveAshedPath({
        id: "desert-storm",
        labelKey: "desertStorm",
        href: "/desert-storm",
        kind: "iframe",
      }),
    ).toBe("/desertstorm");
  });

  it("returns undefined for native pages", () => {
    expect(
      resolveAshedPath({
        id: "members",
        labelKey: "members",
        href: "/members",
        kind: "native",
      }),
    ).toBeUndefined();
  });
});

describe("ashedUrlForPath", () => {
  it("builds absolute Ashed URLs", () => {
    expect(ashedUrlForPath("/members")).toBe("https://ashed.online/members");
    expect(ashedUrlForPath("members")).toBe("https://ashed.online/members");
  });
});

describe("resolveIframePage", () => {
  it("resolves known iframe pages", () => {
    expect(resolveIframePage("desert-storm")?.href).toBe("/desert-storm");
  });

  it("returns null for unknown pages", () => {
    expect(resolveIframePage("missing")).toBeNull();
  });
});

describe("legacyAshedRedirect", () => {
  it("redirects legacy paths", () => {
    expect(legacyAshedRedirect(["reports"])).toBe("/reports");
    expect(legacyAshedRedirect(["violations"])).toBe("/members");
    expect(legacyAshedRedirect(["missing"])).toBeNull();
    expect(legacyAshedRedirect(["a", "b"])).toBeNull();
  });
});

describe("filterNavGroupsForPermissions", () => {
  it("hides video upload without upload:write", () => {
    const filtered = filterNavGroupsForPermissions(NAV_GROUPS, new Set(["members:read"]));
    const hqNative = filtered.find((group) => group.id === "hq-native");
    expect(hqNative).toBeUndefined();
  });

  it("keeps video upload when upload:write is granted", () => {
    const filtered = filterNavGroupsForPermissions(
      NAV_GROUPS,
      new Set(["members:read", "upload:write"]),
    );
    const hqNative = filtered.find((group) => group.id === "hq-native");
    expect(hqNative?.pages.some((page) => page.id === "video-upload")).toBe(true);
  });
});

describe("isNavActive", () => {
  it("matches exact and nested paths", () => {
    expect(isNavActive("/members", "/members")).toBe(true);
    expect(isNavActive("/tools/video-upload/abc/review", "/tools/video-upload")).toBe(
      true,
    );
    expect(isNavActive("/dashboard", "/members")).toBe(false);
  });

  it("matches root path only for home", () => {
    expect(isNavActive("/", "/")).toBe(true);
    expect(isNavActive("/members", "/")).toBe(false);
  });
});

describe("navLinkActive", () => {
  it("does not highlight /settings on /settings/team", () => {
    expect(navLinkActive("/settings/team", "/settings")).toBe(false);
    expect(navLinkActive("/settings/team", "/settings/team")).toBe(true);
  });

  it("does not highlight /account on nested paths", () => {
    expect(navLinkActive("/account", "/account")).toBe(true);
  });

  it("matches /profile exactly", () => {
    expect(navLinkActive("/profile", "/profile")).toBe(true);
    expect(navLinkActive("/profile/settings", "/profile")).toBe(false);
  });
});

describe("NAV_GROUPS alliance-management", () => {
  it("ends with alliance-settings", () => {
    const group = NAV_GROUPS.find((g) => g.id === "alliance-management");
    expect(group).toBeDefined();
    const lastPage = group!.pages[group!.pages.length - 1];
    expect(lastPage?.id).toBe("alliance-settings");
  });

  it("does not include account in hq-native", () => {
    const hqNative = NAV_GROUPS.find((g) => g.id === "hq-native");
    expect(hqNative?.pages.some((p) => p.id === "account")).toBe(false);
  });
});
