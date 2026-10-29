import { describe, expect, it } from "vitest";

import {
  rosterMismatchMemberNames,
  rosterNamesForScoreSave,
} from "./invalid-member.shared";

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

describe("rosterNamesForScoreSave", () => {
  it("keeps former members so a leaderboard match can still be saved", () => {
    const names = rosterNamesForScoreSave([
      { id: "active-1", name: "Nolde", status: "active" },
      { id: "former-1", name: "Hawkeye", status: "former" },
      { id: "  ", name: "Blank", status: "active" },
    ]);

    expect([...names.keys()]).toEqual(["active-1", "former-1"]);
    expect(names.get("former-1")).toBe("Hawkeye");
    expect(
      rosterMismatchMemberNames(
        [
          { memberId: "former-1", memberName: "Hawkeye" },
          { memberId: "missing", memberName: "Not Here" },
        ],
        new Set(names.keys()),
      ),
    ).toEqual(["Not Here"]);
  });
});
