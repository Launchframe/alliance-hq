import { describe, expect, it } from "vitest";

import {
  rosterAbsenceMassFormerPreview,
  rosterMemberIdsAbsentFromAshed,
} from "./roster-absence.shared";

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

describe("rosterAbsenceMassFormerPreview", () => {
  it("flags confirm when a large share of confirmed actives would go former", () => {
    const local = [
      confirmed("keep"),
      confirmed("a"),
      confirmed("b"),
      confirmed("c"),
      confirmed("d"),
      confirmed("e"),
      confirmed("f"),
      confirmed("g"),
      confirmed("h"),
      confirmed("i"),
    ];
    const preview = rosterAbsenceMassFormerPreview({
      local,
      returnedAshedMemberIds: ["keep", "a", "b", "c", "d", "e", "f"],
    });
    expect(preview.absentIds).toEqual(["g", "h", "i"]);
    expect(preview.confirmedActiveCount).toBe(10);
    expect(preview.needsConfirm).toBe(true);
  });

  it("does not flag confirm for a small absence", () => {
    const local = Array.from({ length: 10 }, (_, i) =>
      confirmed(`m${i}`),
    );
    const preview = rosterAbsenceMassFormerPreview({
      local,
      returnedAshedMemberIds: local.slice(0, 9).map((row) => row.ashedMemberId),
    });
    expect(preview.absentIds).toEqual(["m9"]);
    expect(preview.needsConfirm).toBe(false);
  });
});
