import { describe, expect, it } from "vitest";

import {
  duplicateMemberRowIds,
  findDuplicateMemberAssignments,
} from "@/lib/video/review-validation";

describe("findDuplicateMemberAssignments", () => {
  it("returns members assigned to multiple rows", () => {
    const issues = findDuplicateMemberAssignments([
      { id: "r1", memberId: "m1", memberName: "Freddy" },
      { id: "r2", memberId: "m1", memberName: "Freddy" },
      { id: "r3", memberId: "m2", memberName: "Bat Pig" },
      { id: "r4", memberId: null, memberName: null },
    ]);

    expect(issues).toEqual([
      {
        memberId: "m1",
        memberName: "Freddy",
        rowIds: ["r1", "r2"],
      },
    ]);
  });

  it("returns empty when all members are unique", () => {
    expect(
      findDuplicateMemberAssignments([
        { id: "r1", memberId: "m1", memberName: "Freddy" },
        { id: "r2", memberId: "m2", memberName: "Bat Pig" },
      ]),
    ).toEqual([]);
  });

  it("uses member id when name is missing", () => {
    const issues = findDuplicateMemberAssignments([
      { id: "r1", memberId: "m1", memberName: null },
      { id: "r2", memberId: "m1", memberName: null },
    ]);
    expect(issues[0]?.memberName).toBe("m1");
  });
});

describe("duplicateMemberRowIds", () => {
  it("flattens duplicate row ids", () => {
    const ids = duplicateMemberRowIds([
      { memberId: "m1", memberName: "Freddy", rowIds: ["r1", "r2"] },
    ]);
    expect([...ids]).toEqual(["r1", "r2"]);
  });
});
