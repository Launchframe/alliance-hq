import { describe, expect, it } from "vitest";

import { resolveMemberLinkOnboardingInitialState } from "./onboarding-bootstrap.shared";

describe("resolveMemberLinkOnboardingInitialState", () => {
  it("defaults to welcome when there is no pending state or claim target", () => {
    expect(
      resolveMemberLinkOnboardingInitialState({
        pending: null,
        claimTarget: null,
      }),
    ).toEqual({ phase: "welcome" });
  });

  it("routes to claim when a commander claim invite is accepted but not linked", () => {
    expect(
      resolveMemberLinkOnboardingInitialState({
        pending: null,
        claimTarget: { commanderName: "Alpha" },
      }),
    ).toEqual({ phase: "claim", claimCommanderName: "Alpha" });
  });

  it("prefers pending walkthrough over claim target", () => {
    expect(
      resolveMemberLinkOnboardingInitialState({
        pending: { kind: "link_walkthrough", step: 0 },
        claimTarget: { commanderName: "Alpha" },
      }),
    ).toEqual({ phase: "walkthrough" });
  });

  it("restores fuzzy pick candidates from pending state", () => {
    expect(
      resolveMemberLinkOnboardingInitialState({
        pending: {
          kind: "link_fuzzy_pick",
          candidates: [{ memberId: "m1", name: "Bravo" }],
          gameUid: "1234567890123456",
          gameUserName: "Bravo",
          reportedName: "Bravo",
        },
        claimTarget: null,
      }),
    ).toEqual({
      phase: "fuzzy",
      candidates: [{ memberId: "m1", name: "Bravo" }],
    });
  });
});
