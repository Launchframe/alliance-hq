import { describe, expect, it } from "vitest";

import { rosterMismatchMemberNames } from "./invalid-member.shared";

describe("rosterMismatchMemberNames", () => {
  it("returns unique names for members missing from the active roster", () => {
    expect(
      rosterMismatchMemberNames(
        [
          { memberId: "known", memberName: "AanRockID" },
          { memberId: "missing-1", memberName: "Jin" },
          { memberId: "missing-1", memberName: "Jin" },
          { memberId: "missing-2", memberName: " Rara " },
          { memberId: "missing-3", memberName: "" },
          { memberId: "gone", memberName: "Starbuck7", deleted: true },
        ],
        new Set(["known"]),
      ),
    ).toEqual(["Jin", "Rara"]);
  });
});