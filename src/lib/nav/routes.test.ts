import { describe, expect, it } from "vitest";

import {
  ashedUrlForPath,
  isNavActive,
  legacyAshedRedirect,
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
