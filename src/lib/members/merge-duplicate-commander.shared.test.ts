import { describe, expect, it } from "vitest";

import {
  duplicateValueIsNewer,
  evaluateMergeEligibility,
  isMergeDuplicateErrorCode,
  mergeDuplicateErrorKey,
  mergedPreviousNames,
  type MergeSide,
} from "./merge-duplicate-commander.shared";

function side(overrides: Partial<MergeSide> = {}): MergeSide {
  return {
    ashedMemberId: "m-kept",
    rosterStatus: "active",
    commanderId: "c-kept",
    gameServerNumber: 1234,
    gameUid: null,
    lastrankPublicId: null,
    hqUserIds: [],
    discordUserId: null,
    ...overrides,
  };
}

const dupDefaults: Partial<MergeSide> = {
  ashedMemberId: "m-dup",
  commanderId: "c-dup",
};

describe("evaluateMergeEligibility", () => {
  it("allows a name-change duplicate on the same server", () => {
    expect(
      evaluateMergeEligibility(
        side({ hqUserIds: ["u1"] }),
        side({ ...dupDefaults, lastrankPublicId: 42 }),
      ),
    ).toEqual({ ok: true });
  });

  it("rejects merging a member into itself", () => {
    expect(evaluateMergeEligibility(side(), side())).toEqual({
      ok: false,
      code: "same_member",
    });
    expect(
      evaluateMergeEligibility(side(), side({ ashedMemberId: "m-dup" })),
    ).toEqual({ ok: false, code: "same_member" });
  });

  it("requires both members to be active with commanders", () => {
    expect(
      evaluateMergeEligibility(side(), side({ ...dupDefaults, rosterStatus: "former" })),
    ).toEqual({ ok: false, code: "not_active" });
    expect(
      evaluateMergeEligibility(side({ commanderId: null }), side(dupDefaults)),
    ).toEqual({ ok: false, code: "not_active" });
  });

  it("rejects different game servers but tolerates an unknown server", () => {
    expect(
      evaluateMergeEligibility(side(), side({ ...dupDefaults, gameServerNumber: 99 })),
    ).toEqual({ ok: false, code: "different_server" });
    expect(
      evaluateMergeEligibility(side(), side({ ...dupDefaults, gameServerNumber: null })),
    ).toEqual({ ok: true });
  });

  it("never merges two distinct game identities or owners", () => {
    const cases: Array<[Partial<MergeSide>, Partial<MergeSide>]> = [
      [{ gameUid: "111111111111" }, { gameUid: "222222222222" }],
      [{ lastrankPublicId: 1 }, { lastrankPublicId: 2 }],
      [{ discordUserId: "d1" }, { discordUserId: "d2" }],
      [{ hqUserIds: ["u1"] }, { hqUserIds: ["u2"] }],
    ];
    for (const [kept, dup] of cases) {
      expect(
        evaluateMergeEligibility(side(kept), side({ ...dupDefaults, ...dup })),
      ).toEqual({ ok: false, code: "conflicting_links" });
    }
  });

  it("allows links owned only by one side, or by the same account", () => {
    expect(
      evaluateMergeEligibility(side(), side({ ...dupDefaults, hqUserIds: ["u2"] })),
    ).toEqual({ ok: true });
    expect(
      evaluateMergeEligibility(
        side({ hqUserIds: ["u1"], discordUserId: "d1" }),
        side({ ...dupDefaults, hqUserIds: ["u1"], discordUserId: "d1" }),
      ),
    ).toEqual({ ok: true });
  });
});

describe("mergedPreviousNames", () => {
  it("keeps the old name and both histories without the new name", () => {
    expect(
      mergedPreviousNames({
        keptCurrentName: "OldName",
        keptPreviousNames: ["Older"],
        duplicatePreviousNames: ["Older", "NewName", "Typo"],
        newName: "NewName",
      }),
    ).toEqual(["Older", "OldName", "Typo"]);
  });

  it("does not record the name when it did not change", () => {
    expect(
      mergedPreviousNames({
        keptCurrentName: "Same",
        keptPreviousNames: [],
        duplicatePreviousNames: [],
        newName: "Same",
      }),
    ).toEqual([]);
  });
});

describe("duplicateValueIsNewer", () => {
  const older = new Date("2026-01-01T00:00:00Z");
  const newer = new Date("2026-02-01T00:00:00Z");

  it("prefers the most recently updated value", () => {
    expect(
      duplicateValueIsNewer({
        keptValuePresent: true,
        duplicateValuePresent: true,
        keptUpdatedAt: older,
        duplicateUpdatedAt: newer,
      }),
    ).toBe(true);
    expect(
      duplicateValueIsNewer({
        keptValuePresent: true,
        duplicateValuePresent: true,
        keptUpdatedAt: newer,
        duplicateUpdatedAt: older,
      }),
    ).toBe(false);
  });

  it("fills gaps but never replaces with nothing", () => {
    expect(
      duplicateValueIsNewer({
        keptValuePresent: false,
        duplicateValuePresent: true,
        keptUpdatedAt: null,
        duplicateUpdatedAt: null,
      }),
    ).toBe(true);
    expect(
      duplicateValueIsNewer({
        keptValuePresent: true,
        duplicateValuePresent: false,
        keptUpdatedAt: null,
        duplicateUpdatedAt: newer,
      }),
    ).toBe(false);
  });
});

describe("error codes", () => {
  it("maps every code to a message key", () => {
    expect(mergeDuplicateErrorKey("same_member")).toBe("sameMember");
    expect(mergeDuplicateErrorKey("not_active")).toBe("notActive");
    expect(mergeDuplicateErrorKey("different_server")).toBe("differentServer");
    expect(mergeDuplicateErrorKey("conflicting_links")).toBe("conflictingLinks");
    expect(mergeDuplicateErrorKey("generic")).toBe("generic");
    expect(isMergeDuplicateErrorCode("not_active")).toBe(true);
    expect(isMergeDuplicateErrorCode("nope")).toBe(false);
  });
});
