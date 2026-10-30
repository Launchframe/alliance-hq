import { describe, expect, it } from "vitest";

import { rosterMemberIdsAbsentFromAshed } from "./roster-absence.shared";

const confirmed = (
  ashedMemberId: string,
  status = "active",
): {
  ashedMemberId: string;
  status: string;
  ashedConfirmed: boolean;
  ashedAllianceId: string;
} => ({
  ashedMemberId,
  status,
  ashedConfirmed: true,
  ashedAllianceId: "ashed-alliance",
});

describe("rosterMemberIdsAbsentFromAshed", () => {
  it("marks a confirmed member missing from a full list former", () => {
    expect(
      rosterMemberIdsAbsentFromAshed({
        local: [confirmed("still-here"), confirmed("left")],
        returnedAshedMemberIds: ["still-here"],
      }),
    ).toEqual(["left"]);
  });

  it("keeps a HQ row Ashed has never confirmed", () => {
    expect(
      rosterMemberIdsAbsentFromAshed({
        local: [
          confirmed("still-here"),
          {
            ashedMemberId: "just-added",
            status: "active",
            ashedConfirmed: false,
            ashedAllianceId: "ashed-alliance",
          },
        ],
        returnedAshedMemberIds: ["still-here"],
      }),
    ).toEqual([]);
  });

  it("inactivates nobody when the Ashed list is empty", () => {
    expect(
      rosterMemberIdsAbsentFromAshed({
        local: [confirmed("still-here"), confirmed("left")],
        returnedAshedMemberIds: [],
      }),
    ).toEqual([]);
  });

  it("inactivates nobody when the list is smaller than half the confirmed roster", () => {
    expect(
      rosterMemberIdsAbsentFromAshed({
        local: [
          confirmed("a"),
          confirmed("b"),
          confirmed("c"),
          confirmed("d"),
        ],
        returnedAshedMemberIds: ["a"],
      }),
    ).toEqual([]);
  });

  it("keeps a guarded member active", () => {
    expect(
      rosterMemberIdsAbsentFromAshed({
        local: [confirmed("still-here"), confirmed("guarded")],
        returnedAshedMemberIds: ["still-here"],
        guardedMemberIds: ["guarded"],
      }),
    ).toEqual([]);
  });

  it("does not judge a native roster row by an Ashed list", () => {
    expect(
      rosterMemberIdsAbsentFromAshed({
        local: [
          confirmed("still-here"),
          {
            ashedMemberId: "native-row",
            status: "active",
            ashedConfirmed: true,
            ashedAllianceId: "hq-native",
          },
        ],
        returnedAshedMemberIds: ["still-here"],
      }),
    ).toEqual([]);
  });

  it("leaves members who are already former", () => {
    expect(
      rosterMemberIdsAbsentFromAshed({
        local: [confirmed("still-here"), confirmed("already-left", "former")],
        returnedAshedMemberIds: ["still-here"],
      }),
    ).toEqual([]);
  });
});
