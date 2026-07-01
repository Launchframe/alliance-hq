import { describe, expect, it } from "vitest";

import {
  filterHelpRequestRosterRows,
  helpRequestRequesterInGameName,
  helpRequestRosterNameNeedles,
} from "./member-link-help-review.shared";

describe("helpRequestRosterNameNeedles", () => {
  it("uses only UID lookup name for claim_conflict roster hints", () => {
    expect(
      helpRequestRosterNameNeedles({
        context: "claim_conflict",
        reportedName: "BOTCrime DwDx",
        gameUserName: "CustomerSupportPanda",
      }),
    ).toEqual(["CustomerSupportPanda"]);
  });

  it("uses reported and lookup names for other help contexts", () => {
    expect(
      helpRequestRosterNameNeedles({
        context: "roster_miss",
        reportedName: "Typed Name",
        gameUserName: "Lookup Name",
      }),
    ).toEqual(["Typed Name", "Lookup Name"]);
  });
});

describe("helpRequestRequesterInGameName", () => {
  it("prefers lookup name over invite target for claim_conflict", () => {
    expect(
      helpRequestRequesterInGameName({
        context: "claim_conflict",
        reportedName: "BOTCrime DwDx",
        gameUserName: "CustomerSupportPanda",
        requesterHandle: "beta-test-1@gmail.com",
      }),
    ).toBe("CustomerSupportPanda");
  });

  it("prefers reported name for roster_miss", () => {
    expect(
      helpRequestRequesterInGameName({
        context: "roster_miss",
        reportedName: "Typed Name",
        gameUserName: "Lookup Name",
        requesterHandle: "user@example.com",
      }),
    ).toBe("Typed Name");
  });
});

describe("filterHelpRequestRosterRows", () => {
  const rows = [
    { currentName: "BOTCrime DwDx", ashedMemberId: "1" },
    { currentName: "CustomerSupportPanda", ashedMemberId: "2" },
    { currentName: "●モリノ", ashedMemberId: "3" },
  ];

  it("returns all rows when query is empty", () => {
    expect(filterHelpRequestRosterRows(rows, "")).toEqual(rows);
    expect(filterHelpRequestRosterRows(rows, "   ")).toEqual(rows);
  });

  it("filters by case-insensitive substring", () => {
    expect(filterHelpRequestRosterRows(rows, "botcrime")).toEqual([rows[0]]);
    expect(filterHelpRequestRosterRows(rows, "panda")).toEqual([rows[1]]);
  });
});
