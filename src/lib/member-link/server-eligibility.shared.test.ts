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

  it("rejects when known commander home differs from alliance (true home mismatch)", () => {
    expect(
      resolveMemberLinkServerEligibility({
        lookupServer: 1211,
        allianceServer: 1211,
        knownCommanderHomeServer: 1288,
      }),
    ).toEqual({ kind: "rejected", reason: "known_home_mismatch" });
  });

  it("rejects known home mismatch even after honor-system alliance confirm", () => {
    expect(
      resolveMemberLinkServerEligibility({
        lookupServer: 1288,
        allianceServer: 1211,
        knownCommanderHomeServer: 1288,
        allianceHomeConfirmed: true,
      }),
    ).toEqual({ kind: "rejected", reason: "known_home_mismatch" });
  });

  describe("server transfer (known home differs from alliance)", () => {
    const base = {
      lookupServer: 1249,
      allianceServer: 1249,
      knownCommanderHomeServer: 1211,
    };

    it("rejects when the member was not invited or did not redeem a join code", () => {
      expect(resolveMemberLinkServerEligibility(base)).toEqual({
        kind: "rejected",
        reason: "known_home_mismatch",
      });
    });

    it("asks to confirm the transfer when vouched and positioned on the alliance server", () => {
      expect(
        resolveMemberLinkServerEligibility({ ...base, transferEligible: true }),
      ).toEqual({ kind: "confirm_transfer", knownServer: 1211, allianceServer: 1249 });
    });

    it("allows after the member confirms the transfer", () => {
      expect(
        resolveMemberLinkServerEligibility({
          ...base,
          transferEligible: true,
          allianceHomeConfirmed: true,
        }),
      ).toEqual({ kind: "eligible", reason: "user_confirmed_server_transfer" });
    });

    it("asks the member to return home when positioned elsewhere", () => {
      expect(
        resolveMemberLinkServerEligibility({
          ...base,
          lookupServer: 1288,
          transferEligible: true,
          allianceHomeConfirmed: true,
        }),
      ).toEqual({ kind: "rejected", reason: "transfer_position_mismatch" });
    });

    it("asks the member to return home when the position is unknown", () => {
      expect(
        resolveMemberLinkServerEligibility({
          ...base,
          lookupServer: null,
          transferEligible: true,
        }),
      ).toEqual({ kind: "rejected", reason: "transfer_position_mismatch" });
    });

    it("never lets honor-system confirm alone override a known home", () => {
      expect(
        resolveMemberLinkServerEligibility({ ...base, allianceHomeConfirmed: true }),
      ).toEqual({ kind: "rejected", reason: "known_home_mismatch" });
    });
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
