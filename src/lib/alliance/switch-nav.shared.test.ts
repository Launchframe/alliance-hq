import { describe, expect, it } from "vitest";

import {
  isNativeHqPath,
  resolveAllianceSwitchTargetPath,
} from "./switch-nav.shared";

describe("isNativeHqPath", () => {
  it("includes settings team and native nav pages", () => {
    expect(isNativeHqPath("/settings/team")).toBe(true);
    expect(isNativeHqPath("/members")).toBe(true);
    expect(isNativeHqPath("/settings")).toBe(true);
  });

  it("includes native dashboard and excludes Ashed iframe routes", () => {
    expect(isNativeHqPath("/dashboard")).toBe(true);
    expect(isNativeHqPath("/dashboard/linking")).toBe(true);
    expect(isNativeHqPath("/donations")).toBe(false);
  });
});

describe("resolveAllianceSwitchTargetPath", () => {
  it("preserves native HQ path on switch", () => {
    expect(
      resolveAllianceSwitchTargetPath({
        currentPath: "/settings/team",
        apiRedirectPath: "/dashboard",
      }),
    ).toBe("/settings/team");
  });

  it("preserves native dashboard on switch", () => {
    expect(
      resolveAllianceSwitchTargetPath({
        currentPath: "/dashboard",
        apiRedirectPath: "/members",
      }),
    ).toBe("/dashboard");
  });

  it("uses API redirect on iframe routes", () => {
    expect(
      resolveAllianceSwitchTargetPath({
        currentPath: "/donations",
        apiRedirectPath: "/dashboard",
      }),
    ).toBe("/dashboard");
  });

  it("redirects to Ashed landing when switching from a native HQ path", () => {
    expect(
      resolveAllianceSwitchTargetPath({
        currentPath: "/members",
        apiRedirectPath: "/dashboard",
        targetOperatingMode: "ashed",
      }),
    ).toBe("/dashboard");
  });

  it("preserves native HQ path when target alliance is also native", () => {
    expect(
      resolveAllianceSwitchTargetPath({
        currentPath: "/members",
        apiRedirectPath: "/members",
        targetOperatingMode: "native",
      }),
    ).toBe("/members");
  });
});
