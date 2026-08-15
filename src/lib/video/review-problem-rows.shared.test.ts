import { describe, expect, it } from "vitest";

import {
  buildRosterReviewProblemRowIds,
  buildScoreReviewProblemRowIds,
  isScoreReviewProblemRow,
  reviewRowWindowScrollTop,
} from "@/lib/video/review-problem-rows.shared";

describe("isScoreReviewProblemRow", () => {
  it("flags unmatched, duplicate, conflict, zero, and negative scores", () => {
    const duplicateRowIds = new Set(["dup"]);
    expect(
      isScoreReviewProblemRow(
        {
          id: "a",
          memberId: null,
          score: "100",
        },
        { duplicateRowIds, zeroScoreWarningDisabled: false },
      ),
    ).toBe(true);
    expect(
      isScoreReviewProblemRow(
        {
          id: "dup",
          memberId: "m1",
          score: "100",
        },
        { duplicateRowIds, zeroScoreWarningDisabled: false },
      ),
    ).toBe(true);
    expect(
      isScoreReviewProblemRow(
        {
          id: "c",
          memberId: "m1",
          score: "100",
          scoreConflict: 1,
        },
        { duplicateRowIds, zeroScoreWarningDisabled: false },
      ),
    ).toBe(true);
    expect(
      isScoreReviewProblemRow(
        {
          id: "d",
          memberId: "m1",
          score: "0",
        },
        { duplicateRowIds, zeroScoreWarningDisabled: false },
      ),
    ).toBe(true);
    expect(
      isScoreReviewProblemRow(
        {
          id: "e",
          memberId: "m1",
          score: "-5",
        },
        { duplicateRowIds, zeroScoreWarningDisabled: false },
      ),
    ).toBe(true);
  });

  it("ignores zero scores when warnings are disabled", () => {
    expect(
      isScoreReviewProblemRow(
        {
          id: "ok",
          memberId: "m1",
          score: "0",
        },
        { duplicateRowIds: new Set(), zeroScoreWarningDisabled: true },
      ),
    ).toBe(false);
  });
});

describe("buildScoreReviewProblemRowIds", () => {
  it("preserves visible row order", () => {
    const rowsById = new Map([
      ["a", { id: "a", memberId: "m1", score: "100" }],
      ["b", { id: "b", memberId: null, score: "50" }],
      ["c", { id: "c", memberId: "m2", score: "25" }],
    ]);
    expect(
      buildScoreReviewProblemRowIds(["c", "b", "a"], rowsById, {
        duplicateRowIds: new Set(),
        zeroScoreWarningDisabled: true,
      }),
    ).toEqual(["b"]);
  });
});

describe("buildRosterReviewProblemRowIds", () => {
  it("includes duplicate members and missing ranks", () => {
    expect(
      buildRosterReviewProblemRowIds(
        ["a", "b"],
        [
          {
            id: "a",
            ocrName: "Alpha",
            allianceRank: null,
            memberId: "m1",
            memberName: "Alpha",
            matchConfidence: 1,
            deleted: 0,
          },
          {
            id: "b",
            ocrName: "Beta",
            allianceRank: 3,
            memberId: "m1",
            memberName: "Alpha",
            matchConfidence: 1,
            deleted: 0,
          },
        ],
        {
          duplicateRowIds: new Set(["a", "b"]),
          unmatchedRowIds: new Set(),
          existingMemberCount: 50,
        },
      ),
    ).toEqual(["a", "b"]);
  });
});

describe("reviewRowWindowScrollTop", () => {
  it("places the row just below sticky chrome using window coordinates", () => {
    expect(
      reviewRowWindowScrollTop({
        rowTop: 400,
        scrollY: 200,
        stickyOffsetPx: 96,
      }),
    ).toBe(496);
  });

  it("does not scroll above the page top", () => {
    expect(
      reviewRowWindowScrollTop({
        rowTop: 10,
        scrollY: 0,
        stickyOffsetPx: 96,
      }),
    ).toBe(0);
  });
});
