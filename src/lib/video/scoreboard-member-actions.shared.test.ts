import { describe, expect, it } from "vitest";

import {
  nextPreviousNames,
  SCOREBOARD_MANUAL_MATCH_METHOD,
  scoreboardCreateRowIds,
  scoreboardOcrNameDiffersFromMember,
  scoreboardRenameRowIds,
  scoreboardRowOffersCreate,
  scoreboardRowOffersRename,
} from "./scoreboard-member-actions.shared";

const unmatched = {
  id: "r1",
  ocrName: "SLØwPoKe",
  memberId: null,
  memberName: null,
  matchMethod: "none",
};

const autoMatched = {
  id: "r2",
  ocrName: "NobuU DwDx",
  memberId: "m-nobu",
  memberName: "NobuU DwDx",
  matchMethod: "fuzzy",
};

const manualRename = {
  id: "r3",
  ocrName: "Zudie",
  memberId: "m-zudie",
  memberName: "Zudiedwdx",
  matchMethod: SCOREBOARD_MANUAL_MATCH_METHOD,
};

const members = [
  { id: "m-nobu", current_name: "NobuU DwDx" },
  { id: "m-zudie", current_name: "Zudiedwdx" },
];

describe("scoreboard member review offers", () => {
  it("treats whitespace and case as the same name", () => {
    expect(scoreboardOcrNameDiffersFromMember("  Foo  Bar ", "foo bar")).toBe(
      false,
    );
    expect(scoreboardOcrNameDiffersFromMember("Foo", "Bar")).toBe(true);
  });

  it("offers create only for unmatched rows when the setting is on", () => {
    expect(scoreboardRowOffersCreate(unmatched, true)).toBe(true);
    expect(scoreboardRowOffersCreate(unmatched, false)).toBe(false);
    expect(scoreboardRowOffersCreate(autoMatched, true)).toBe(false);
    expect(
      scoreboardRowOffersCreate({ ...unmatched, deleted: 1 }, true),
    ).toBe(false);
    expect(
      scoreboardRowOffersCreate({ ...unmatched, ocrName: "   " }, true),
    ).toBe(false);
  });

  it("offers rename only after a manual match whose OCR name differs", () => {
    expect(scoreboardRowOffersRename(manualRename, members, true)).toBe(true);
    expect(scoreboardRowOffersRename(manualRename, members, false)).toBe(false);
    expect(scoreboardRowOffersRename(autoMatched, members, true)).toBe(false);
    expect(
      scoreboardRowOffersRename(
        { ...manualRename, ocrName: "Zudiedwdx" },
        members,
        true,
      ),
    ).toBe(false);
  });

  it("collects bulk action ids", () => {
    const rows = [unmatched, autoMatched, manualRename];
    expect(scoreboardCreateRowIds(rows, true)).toEqual(["r1"]);
    expect(scoreboardRenameRowIds(rows, members, true)).toEqual(["r3"]);
    expect(scoreboardCreateRowIds(rows, false)).toEqual([]);
    expect(scoreboardRenameRowIds(rows, members, false)).toEqual([]);
  });
});

describe("nextPreviousNames", () => {
  it("appends the overwritten current name once", () => {
    expect(nextPreviousNames("Old", [], "New")).toEqual(["Old"]);
    expect(nextPreviousNames("Old", ["Old"], "New")).toEqual(["Old"]);
    expect(nextPreviousNames("Same", ["Prior"], "Same")).toEqual(["Prior"]);
  });
});
