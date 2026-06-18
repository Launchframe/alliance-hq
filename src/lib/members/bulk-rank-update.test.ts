import { describe, expect, it } from "vitest";

import { validateBulkMemberRankInput } from "@/lib/members/bulk-rank-update.shared";

describe("validateBulkMemberRankInput", () => {
  it("accepts set with R1–R3", () => {
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

  it("rejects set without valid rank", () => {
    expect(
      validateBulkMemberRankInput({
        memberIds: ["a"],
        action: "set",
        allianceRank: 4,
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
