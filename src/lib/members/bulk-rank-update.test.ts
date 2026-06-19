import { describe, expect, it } from "vitest";

import {
  patchMembersAfterBulkRank,
  validateBulkMemberRankInput,
} from "@/lib/members/bulk-rank-update.shared";
import { parseAshedMemberAllianceRank } from "@/lib/members/alliance-rank";
import type { AshedMember } from "@/lib/video/member-matcher";

describe("validateBulkMemberRankInput", () => {
  it("accepts set with R1–R4", () => {
    expect(
      validateBulkMemberRankInput({
        memberIds: ["a", "b"],
        action: "set",
        allianceRank: 2,
      }),
    ).toEqual({
      ok: true,
      memberIds: ["a", "b"],
      action: "set",
      allianceRank: 2,
    });
  });

  it("accepts set with R4", () => {
    expect(
      validateBulkMemberRankInput({
        memberIds: ["a"],
        action: "set",
        allianceRank: 4,
      }),
    ).toEqual({
      ok: true,
      memberIds: ["a"],
      action: "set",
      allianceRank: 4,
    });
  });

  it("rejects set without valid rank", () => {
    expect(
      validateBulkMemberRankInput({
        memberIds: ["a"],
        action: "set",
        allianceRank: 5,
      }).ok,
    ).toBe(false);
  });

  it("accepts clear", () => {
    expect(
      validateBulkMemberRankInput({
        memberIds: ["a"],
        action: "clear",
      }),
    ).toEqual({
      ok: true,
      memberIds: ["a"],
      action: "clear",
    });
  });
});

describe("patchMembersAfterBulkRank", () => {
  const members: AshedMember[] = [
    {
      id: "m1",
      current_name: "Alice",
      alliance_rank: 4,
      rank: "Warlord",
    },
    {
      id: "m2",
      current_name: "Bob",
      rank: "R2",
      alliance_rank: 2,
    },
  ];

  it("updates alliance_rank so display parsers pick up the new rank", () => {
    const patched = patchMembersAfterBulkRank(members, {
      memberIds: ["m1"],
      action: "set",
      allianceRank: 3,
    });

    expect(parseAshedMemberAllianceRank(patched[0]!)).toEqual({
      rank: 3,
      title: null,
    });
    expect(parseAshedMemberAllianceRank(patched[1]!)).toEqual({
      rank: 2,
      title: null,
    });
  });

  it("clears rank fields for clear action", () => {
    const patched = patchMembersAfterBulkRank(members, {
      memberIds: ["m2"],
      action: "clear",
    });

    expect(parseAshedMemberAllianceRank(patched[1]!)).toEqual({
      rank: null,
      title: null,
    });
  });
});
