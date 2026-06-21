import { describe, expect, it } from "vitest";

import { shouldShowTeamAccessNav } from "./team-access-nav.shared";

describe("shouldShowTeamAccessNav", () => {
  it("shows for active members with alliance context", () => {
    expect(
      shouldShowTeamAccessNav({
        allianceId: "a1",
        hasActiveMembership: true,
        isPlatformMaintainer: false,
      }),
    ).toBe(true);
  });

  it("shows for platform maintainers with alliance context but no membership", () => {
    expect(
      shouldShowTeamAccessNav({
        allianceId: "a1",
        hasActiveMembership: false,
        isPlatformMaintainer: true,
      }),
    ).toBe(true);
  });

  it("hides without alliance context", () => {
    expect(
      shouldShowTeamAccessNav({
        allianceId: null,
        hasActiveMembership: true,
        isPlatformMaintainer: true,
      }),
    ).toBe(false);
  });

  it("hides for users without membership or maintainer flag", () => {
    expect(
      shouldShowTeamAccessNav({
        allianceId: "a1",
        hasActiveMembership: false,
        isPlatformMaintainer: false,
      }),
    ).toBe(false);
  });
});
