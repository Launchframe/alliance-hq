import { describe, expect, it } from "vitest";

import {
  ManualPickEligibilityError,
  depletingManualPickErrorMessage,
  evaluateDepletingManualPick,
  isManualPickEligibilityError,
  officerConfirmedManualPickOverride,
  shouldReleasePriorPoolSelection,
} from "@/lib/trains/depleting-manual-pick.shared";

describe("evaluateDepletingManualPick", () => {
  it("allows an unselected pool member", () => {
    expect(
      evaluateDepletingManualPick({
        memberId: "a",
        unselectedMemberIds: ["a", "b"],
        poolMemberIds: ["a", "b", "c"],
      }),
    ).toEqual({ ok: true });
  });

  it("rejects a member already awarded in this generation", () => {
    expect(
      evaluateDepletingManualPick({
        memberId: "c",
        unselectedMemberIds: ["a", "b"],
        poolMemberIds: ["a", "b", "c"],
      }),
    ).toEqual({ ok: false, reason: "already_awarded" });
  });

  it("rejects a member missing from the current pool", () => {
    expect(
      evaluateDepletingManualPick({
        memberId: "z",
        unselectedMemberIds: ["a"],
        poolMemberIds: ["a", "b"],
      }),
    ).toEqual({ ok: false, reason: "not_in_pool" });
  });
});

describe("depletingManualPickErrorMessage", () => {
  it("returns distinct API errors for each gate", () => {
    expect(depletingManualPickErrorMessage("already_awarded")).toMatch(
      /already selected/i,
    );
    expect(depletingManualPickErrorMessage("not_in_pool")).toMatch(
      /not in the current conductor pool/i,
    );
  });
});

describe("officerConfirmedManualPickOverride", () => {
  it("accepts the dedicated override flag or the same-generation alias", () => {
    expect(officerConfirmedManualPickOverride({})).toBe(false);
    expect(
      officerConfirmedManualPickOverride({ allowEligibilityOverride: true }),
    ).toBe(true);
    expect(
      officerConfirmedManualPickOverride({ allowSameGenerationReuse: true }),
    ).toBe(true);
  });
});

describe("isManualPickEligibilityError", () => {
  it("recognizes typed eligibility override errors", () => {
    const error = new ManualPickEligibilityError(
      "already_awarded",
      depletingManualPickErrorMessage("already_awarded"),
    );
    expect(isManualPickEligibilityError(error)).toBe(true);
    expect(isManualPickEligibilityError(new Error("nope"))).toBe(false);
  });
});

describe("shouldReleasePriorPoolSelection", () => {
  it("releases only when replacing with a different member", () => {
    expect(
      shouldReleasePriorPoolSelection({
        previousMemberId: "alice",
        nextMemberId: "bob",
      }),
    ).toBe(true);
    expect(
      shouldReleasePriorPoolSelection({
        previousMemberId: "alice",
        nextMemberId: "alice",
      }),
    ).toBe(false);
    expect(
      shouldReleasePriorPoolSelection({
        previousMemberId: null,
        nextMemberId: "bob",
      }),
    ).toBe(false);
  });
});
