import { describe, expect, it } from "vitest";

import { resolveAshedConnectRole } from "@/lib/rbac/resolve-ashed-connect-role";

describe("resolveAshedConnectRole", () => {
  it("grants owner on brand-new alliance when Ashed user is owner", () => {
    expect(
      resolveAshedConnectRole({
        wasAllianceCreated: true,
        allianceHasOwner: false,
        ashedAccessRole: "owner",
      }),
    ).toBe("owner");
  });

  it("grants officer on brand-new alliance when Ashed user is collaborator", () => {
    expect(
      resolveAshedConnectRole({
        wasAllianceCreated: true,
        allianceHasOwner: false,
        ashedAccessRole: "maintainer",
      }),
    ).toBe("officer");
  });

  it("caps Ashed owner to officer when alliance already has an HQ owner", () => {
    expect(
      resolveAshedConnectRole({
        wasAllianceCreated: false,
        allianceHasOwner: true,
        ashedAccessRole: "owner",
      }),
    ).toBe("officer");
  });

  it("caps Ashed collaborator to officer when alliance already has an HQ owner", () => {
    expect(
      resolveAshedConnectRole({
        wasAllianceCreated: false,
        allianceHasOwner: true,
        ashedAccessRole: "maintainer",
      }),
    ).toBe("officer");
  });

  it("grants member when no manage access on existing owned alliance", () => {
    expect(
      resolveAshedConnectRole({
        wasAllianceCreated: false,
        allianceHasOwner: true,
        ashedAccessRole: null,
      }),
    ).toBe("member");
  });

  it("allows owner on existing alliance without HQ owner yet", () => {
    expect(
      resolveAshedConnectRole({
        wasAllianceCreated: false,
        allianceHasOwner: false,
        ashedAccessRole: "owner",
      }),
    ).toBe("owner");
  });
});
