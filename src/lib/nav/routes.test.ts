import { describe, expect, it } from "vitest";

import {
  ashedUrlForPath,
  filterNavGroupsForAllianceMemberLink,
  filterNavGroupsForPermissions,
  findActiveNavGroupId,
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
  it("hides video upload without hq:video:enqueue", () => {
    const filtered = filterNavGroupsForPermissions(NAV_GROUPS, new Set(["members:read"]));
    const video = filtered.find((group) => group.id === "video");
    expect(video?.pages.some((page) => page.id === "video-upload")).toBe(false);
    expect(video?.pages.some((page) => page.id === "video-queue")).toBe(true);
  });

  it("keeps video upload when hq:video:enqueue is granted", () => {
    const filtered = filterNavGroupsForPermissions(
      NAV_GROUPS,
      new Set(["members:read", "hq:video:enqueue"]),
    );
    const video = filtered.find((group) => group.id === "video");
    expect(video?.pages.some((page) => page.id === "video-upload")).toBe(true);
  });

  it("skips permission filtering for platform maintainers", () => {
    const filtered = filterNavGroupsForPermissions(
      NAV_GROUPS,
      new Set(["hq:admin"]),
      { bypass: true },
    );
    const video = filtered.find((group) => group.id === "video");
    expect(video?.pages.some((page) => page.id === "video-upload")).toBe(true);
  });

  it("hides my-vr when members:write is granted", () => {
    const filtered = filterNavGroupsForPermissions(
      NAV_GROUPS,
      new Set(["members:write"]),
    );
    const reporting = filtered.find((group) => group.id === "performance-reporting");
    expect(reporting?.pages.some((page) => page.id === "my-vr")).toBe(false);
    expect(reporting?.pages.some((page) => page.id === "my-thp")).toBe(false);
    expect(reporting?.pages.some((page) => page.id === "my-kills")).toBe(false);
    expect(reporting?.pages.some((page) => page.id === "viral-resistance")).toBe(
      true,
    );
  });

  it("shows my-vr, my-thp, and my-kills for members without members:write", () => {
    const filtered = filterNavGroupsForPermissions(NAV_GROUPS, new Set());
    const reporting = filtered.find((group) => group.id === "performance-reporting");
    expect(reporting?.pages.some((page) => page.id === "my-vr")).toBe(true);
    expect(reporting?.pages.some((page) => page.id === "my-thp")).toBe(true);
    expect(reporting?.pages.some((page) => page.id === "my-kills")).toBe(true);
    expect(reporting?.pages.some((page) => page.id === "viral-resistance")).toBe(
      false,
    );
  });
});

describe("filterNavGroupsForAllianceMemberLink", () => {
  it("hides my-vr, my-thp, and my-kills without an alliance member link", () => {
    const filtered = filterNavGroupsForAllianceMemberLink(NAV_GROUPS, {
      hasAllianceMemberLink: false,
    });
    const reporting = filtered.find((group) => group.id === "performance-reporting");
    expect(reporting?.pages.some((page) => page.id === "my-vr")).toBe(false);
    expect(reporting?.pages.some((page) => page.id === "my-thp")).toBe(false);
    expect(reporting?.pages.some((page) => page.id === "my-kills")).toBe(false);
    expect(reporting?.pages.some((page) => page.id === "viral-resistance")).toBe(
      true,
    );
  });

  it("keeps my-vr, my-thp, and my-kills when the user has an alliance member link", () => {
    const filtered = filterNavGroupsForAllianceMemberLink(NAV_GROUPS, {
      hasAllianceMemberLink: true,
    });
    const reporting = filtered.find((group) => group.id === "performance-reporting");
    expect(reporting?.pages.some((page) => page.id === "my-vr")).toBe(true);
    expect(reporting?.pages.some((page) => page.id === "my-thp")).toBe(true);
    expect(reporting?.pages.some((page) => page.id === "my-kills")).toBe(true);
  });

  it("hides self-service pages for platform admins browsing another alliance", () => {
    const filtered = filterNavGroupsForAllianceMemberLink(
      filterNavGroupsForPermissions(NAV_GROUPS, new Set(["hq:admin"]), {
        bypass: true,
      }),
      { hasAllianceMemberLink: false },
    );
    const reporting = filtered.find((group) => group.id === "performance-reporting");
    expect(reporting?.pages.some((page) => page.id === "my-vr")).toBe(false);
    expect(reporting?.pages.some((page) => page.id === "my-thp")).toBe(false);
    expect(reporting?.pages.some((page) => page.id === "my-kills")).toBe(false);
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
  it("highlights /settings on /settings/team", () => {
    expect(navLinkActive("/settings/team", "/settings")).toBe(true);
    expect(navLinkActive("/settings/team", "/settings/team")).toBe(true);
  });

  it("highlights /settings on alliance settings sub-pages", () => {
    expect(navLinkActive("/settings/discord", "/settings")).toBe(true);
    expect(navLinkActive("/settings/trains", "/settings")).toBe(true);
    expect(navLinkActive("/settings/game-seasons", "/settings")).toBe(true);
    expect(navLinkActive("/settings/upload-reminders", "/settings")).toBe(true);
    expect(navLinkActive("/settings/team", "/settings")).toBe(true);
    expect(navLinkActive("/settings/discord", "/settings/discord")).toBe(true);
    expect(navLinkActive("/settings/trains", "/settings/trains")).toBe(true);
    expect(navLinkActive("/settings/game-seasons", "/settings/game-seasons")).toBe(
      true,
    );
  });

  it("does not highlight /settings on account or hotkeys routes", () => {
    expect(navLinkActive("/settings/account", "/settings")).toBe(false);
    expect(navLinkActive("/settings/hotkeys", "/settings")).toBe(false);
  });

  it("does not highlight /account on nested paths", () => {
    expect(navLinkActive("/account", "/account")).toBe(true);
  });

  it("matches /profile exactly", () => {
    expect(navLinkActive("/profile", "/profile")).toBe(true);
    expect(navLinkActive("/profile/settings", "/profile")).toBe(false);
  });

  it("highlights members nav for legacy /commanders route", () => {
    expect(navLinkActive("/commanders", "/members")).toBe(true);
    expect(navLinkActive("/members", "/members")).toBe(true);
  });

  it("keeps upload and queue nav highlights independent", () => {
    expect(navLinkActive("/tools/video-upload/queue", "/tools/video-upload")).toBe(
      false,
    );
    expect(
      navLinkActive("/tools/video-upload/queue", "/tools/video-upload/queue"),
    ).toBe(true);
    expect(navLinkActive("/tools/video-upload", "/tools/video-upload")).toBe(
      true,
    );
    expect(
      navLinkActive("/tools/video-upload/job-1/review", "/tools/video-upload"),
    ).toBe(true);
    expect(navLinkActive("/tools/video-processors", "/tools/video-processors")).toBe(
      true,
    );
    expect(
      navLinkActive("/tools/video-processors", "/tools/video-upload"),
    ).toBe(false);
  });
});

describe("NAV_GROUPS alliance-management", () => {
  it("ends with alliance-settings", () => {
    const group = NAV_GROUPS.find((g) => g.id === "alliance-management");
    expect(group).toBeDefined();
    const lastPage = group!.pages[group!.pages.length - 1];
    expect(lastPage?.id).toBe("alliance-settings");
  });

  it("does not include a separate commanders nav page", () => {
    const group = NAV_GROUPS.find((g) => g.id === "alliance-management");
    expect(group?.pages.some((page) => page.id === "commanders")).toBe(false);
  });

  it("does not include account in video group", () => {
    const video = NAV_GROUPS.find((g) => g.id === "video");
    expect(video?.pages.some((p) => p.id === "account")).toBe(false);
    expect(video?.pages.some((p) => p.id === "video-queue")).toBe(true);
  });
});

describe("findActiveNavGroupId alliance-management extras", () => {
  it("includes alliance settings sub-pages when showAllianceSettings is true", () => {
    expect(
      findActiveNavGroupId("/settings/discord", {
        showAllianceSettings: true,
      }),
    ).toBe("alliance-management");
    expect(
      findActiveNavGroupId("/settings/trains", {
        showAllianceSettings: true,
      }),
    ).toBe("alliance-management");
    expect(
      findActiveNavGroupId("/settings/game-seasons", {
        showAllianceSettings: true,
      }),
    ).toBe("alliance-management");
    expect(
      findActiveNavGroupId("/settings/upload-reminders", {
        showAllianceSettings: true,
      }),
    ).toBe("alliance-management");
  });

  it("does not match deleted tag-scoped alliance settings route", () => {
    expect(
      findActiveNavGroupId("/alliance/lfgo/settings", {
        showAllianceSettings: true,
      }),
    ).toBeNull();
    expect(navLinkActive("/alliance/lfgo/settings", "/settings")).toBe(false);
  });
});
