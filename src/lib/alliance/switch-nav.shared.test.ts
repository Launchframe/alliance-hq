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

  it("excludes Ashed iframe routes", () => {
    expect(isNativeHqPath("/dashboard")).toBe(false);
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

  it("uses API redirect on iframe routes", () => {
    expect(
      resolveAllianceSwitchTargetPath({
        currentPath: "/dashboard",
        apiRedirectPath: "/members",
      }),
    ).toBe("/members");
  });
});
