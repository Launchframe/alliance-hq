import { describe, expect, it } from "vitest";
import { canAccessVsCompliance } from "./access.shared";

const read = "vs_compliance:read";
const manage = "vs_compliance:manage";
const settings = "vs_compliance:settings";
const actor = { hqUserId: "hq-user", roleName: "officer", isPlatformMaintainer: false, permissions: new Set([read, manage]) };

describe("discipline permissions", () => {
  it.each(["member", "viewer", "data_entry"])("denies %s even with members:write or forged discipline grants", (roleName) => {
    for (const permission of [read, manage, settings] as const) {
      expect(canAccessVsCompliance({ ...actor, roleName, permissions: new Set(["members:write", read, manage, settings]) }, permission)).toBe(false);
    }
  });

  it("denies anonymous principals, even with claimed owner or platform roles", () => {
    expect(canAccessVsCompliance({ ...actor, hqUserId: null, roleName: "owner", isPlatformMaintainer: true }, manage)).toBe(false);
  });

  it("allows native officers to read and manage, but not change policy settings", () => {
    expect(canAccessVsCompliance(actor, read)).toBe(true);
    expect(canAccessVsCompliance(actor, manage)).toBe(true);
    expect(canAccessVsCompliance({ ...actor, permissions: new Set([settings]) }, settings)).toBe(false);
  });

  it("requires an explicit discipline grant, not members:write alone", () => {
    expect(canAccessVsCompliance({ ...actor, permissions: new Set(["members:write"]) }, manage)).toBe(false);
  });

  it.each(["owner", "maintainer"])("allows owner-equivalent %s settings with an explicit grant", (roleName) => {
    expect(canAccessVsCompliance({ ...actor, roleName, permissions: new Set([settings]) }, settings)).toBe(true);
  });

  it("permits only an authenticated platform override", () => {
    expect(canAccessVsCompliance({ ...actor, roleName: null, isPlatformMaintainer: true, permissions: new Set(["hq:admin"]) }, settings)).toBe(true);
    expect(canAccessVsCompliance({ ...actor, roleName: null, isPlatformMaintainer: false, permissions: new Set(["hq:admin"]) }, settings)).toBe(false);
  });
});
