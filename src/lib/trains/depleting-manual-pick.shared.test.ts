import { describe, expect, it } from "vitest";

import {
  depletingManualPickErrorMessage,
  evaluateDepletingManualPick,
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
