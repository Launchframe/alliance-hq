import { describe, expect, it } from "vitest";

import { resolveMemberLinkServerEligibility } from "./server-eligibility.shared";

describe("resolveMemberLinkServerEligibility", () => {
  it("allows when lookup position matches alliance home", () => {
    expect(
      resolveMemberLinkServerEligibility({
        lookupServer: 1211,
        allianceServer: 1211,
        knownCommanderHomeServer: null,
      }),
    ).toEqual({ kind: "eligible", reason: "lookup_matches" });
  });

  it("allows when commander home is known even if lookup position differs", () => {
    expect(
      resolveMemberLinkServerEligibility({
        lookupServer: 1288,
        allianceServer: 1211,
        knownCommanderHomeServer: 1211,
      }),
    ).toEqual({ kind: "eligible", reason: "known_commander_home" });
  });

  it("requires honor-system confirm when position differs and commander unknown", () => {
    expect(
      resolveMemberLinkServerEligibility({
        lookupServer: 1288,
        allianceServer: 1211,
        knownCommanderHomeServer: null,
      }),
    ).toEqual({
      kind: "confirm_home",
      lookupServer: 1288,
      allianceServer: 1211,
    });
  });

  it("allows after user confirms alliance home", () => {
    expect(
      resolveMemberLinkServerEligibility({
        lookupServer: 1288,
        allianceServer: 1211,
        knownCommanderHomeServer: null,
        allianceHomeConfirmed: true,
      }),
    ).toEqual({ kind: "eligible", reason: "user_confirmed_alliance_home" });
  });

  it("rejects when user claims lookup position is home", () => {
    expect(
      resolveMemberLinkServerEligibility({
        lookupServer: 1288,
        allianceServer: 1211,
        knownCommanderHomeServer: null,
        userClaimedLookupAsHome: true,
      }),
    ).toEqual({ kind: "rejected", reason: "user_claimed_lookup_home" });
  });

  it("rejects when lookup position is missing and commander is unknown", () => {
    expect(
      resolveMemberLinkServerEligibility({
        lookupServer: null,
        allianceServer: 1211,
        knownCommanderHomeServer: null,
      }),
    ).toEqual({ kind: "rejected", reason: "missing_server" });
  });
});
