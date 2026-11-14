import { describe, expect, it } from "vitest";

import {
  nextPreviousNames,
  previousNamesForScoreboardBind,
  sameScoreboardNameList,
  SCOREBOARD_MANUAL_MATCH_METHOD,
  scoreboardAshedNameSuggestions,
  scoreboardAshedRenameNeedsSync,
  scoreboardConfirmedNamesConflict,
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

describe("scoreboardAshedNameSuggestions", () => {
  const ashed = [
    { id: "a1", name: "BatPig" },
    { id: "a2", name: "NobuU DwDx" },
    { id: "a3", name: "Zudie" },
  ];

  it("returns exact matches and excludes HQ roster ids", () => {
    expect(
      scoreboardAshedNameSuggestions("batpig", ashed, new Set()),
    ).toEqual({
      exact: { id: "a1", name: "BatPig", score: 1 },
      suggestions: [],
    });
    expect(
      scoreboardAshedNameSuggestions("batpig", ashed, new Set(["a1"])),
    ).toEqual({ exact: null, suggestions: [] });
  });

  it("returns fuzzy near-matches above the floor", () => {
    const result = scoreboardAshedNameSuggestions("Bat Pig", ashed, new Set());
    expect(result.exact).toBeNull();
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions[0]?.id).toBe("a1");
  });

  it("does not auto-bind when two Ashed members share the exact name", () => {
    const twins = [
      { id: "b", name: "BatPig" },
      { id: "a", name: "batpig" },
    ];
    expect(scoreboardAshedNameSuggestions("BatPig", twins, new Set())).toEqual({
      exact: null,
      suggestions: [
        { id: "a", name: "batpig", score: 1 },
        { id: "b", name: "BatPig", score: 1 },
      ],
    });
  });
});

describe("scoreboard bind name history", () => {
  it("keeps Ashed history and appends the name being replaced", () => {
    expect(
      previousNamesForScoreboardBind({
        ashedCurrentName: "BatPig",
        ashedPreviousNames: ["Piglet"],
        nextName: "Bat Pig",
      }),
    ).toEqual(["Piglet", "BatPig"]);
  });

  it("merges HQ history when the roster row already exists", () => {
    expect(
      previousNamesForScoreboardBind({
        ashedCurrentName: "BatPig",
        ashedPreviousNames: ["Piglet"],
        hqCurrentName: "Bat Pig",
        hqPreviousNames: ["Piglet", "BP"],
        nextName: "Batty",
      }),
    ).toEqual(["Piglet", "BP", "Bat Pig", "BatPig"]);
  });

  it("does not append the current name when it is already the next name", () => {
    expect(
      previousNamesForScoreboardBind({
        ashedCurrentName: "BatPig",
        ashedPreviousNames: ["Piglet"],
        nextName: "BatPig",
      }),
    ).toEqual(["Piglet"]);
  });

  it("detects when Ashed still needs the rename", () => {
    expect(sameScoreboardNameList(["Piglet"], ["Piglet"])).toBe(true);
    expect(sameScoreboardNameList(["Piglet"], ["Piglet", "BatPig"])).toBe(
      false,
    );
    expect(
      scoreboardAshedRenameNeedsSync({
        remoteName: "BatPig",
        remotePreviousNames: ["Piglet"],
        nextName: "Bat Pig",
        nextPreviousNames: ["Piglet", "BatPig"],
      }),
    ).toBe(true);
    expect(
      scoreboardAshedRenameNeedsSync({
        remoteName: "Bat Pig",
        remotePreviousNames: ["Piglet"],
        nextName: "Bat Pig",
        nextPreviousNames: ["Piglet"],
      }),
    ).toBe(false);
  });

  it("flags two confirmed names for the same member", () => {
    expect(
      scoreboardConfirmedNamesConflict([
        { memberKey: "m1", confirmedName: "Bat Pig" },
        { memberKey: "m1", confirmedName: "Batty" },
      ]),
    ).toBe(true);
    expect(
      scoreboardConfirmedNamesConflict([
        { memberKey: "m1", confirmedName: "Bat Pig" },
        { memberKey: "m1", confirmedName: "Bat Pig" },
      ]),
    ).toBe(false);
  });
});
