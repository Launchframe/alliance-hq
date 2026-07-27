import { describe, expect, it } from "vitest";

import {
  buildShortNameMatchRoster,
  SHORT_NAME_MEMBER_MATCH_CASES,
} from "@/lib/video/member-match-short-name.fixtures";
import { MEMBER_FUZZY_AUTO_MATCH_MIN } from "@/lib/video/member-matcher";
import {
  formatHeroPowerMForStorage,
  findUnmatchedRosterRowIds,
  isRosterRowNameMismatch,
  parsedRowsToRosterReviewRows,
  ROSTER_NAME_MATCH_CONFIDENCE_MIN,
} from "@/lib/video/roster-video-review.shared";

describe("roster-video-review.shared", () => {
  it("formats hero power for storage", () => {
    expect(formatHeroPowerMForStorage(94.1)).toBe("94.1M");
    expect(formatHeroPowerMForStorage(null)).toBeNull();
  });

  it("shares the member auto-match confidence floor", () => {
    expect(ROSTER_NAME_MATCH_CONFIDENCE_MIN).toBe(MEMBER_FUZZY_AUTO_MATCH_MIN);
  });

  it("fuzzy-matches roster rows to HQ members on hydrate", () => {
    const rows = parsedRowsToRosterReviewRows(
      [
        {
          id: "1",
          ocrName: "Alpha Player",
          memberId: null,
          memberName: null,
          matchConfidence: 0,
          deleted: 0,
        },
      ],
      [
        {
          id: "m1",
          current_name: "AlphaPlayer",
          status: "active",
        },
      ],
      "LFgo",
    );

    expect(rows[0]?.memberId).toBe("m1");
    expect(rows[0]?.matchConfidence).toBeGreaterThan(0.6);
  });

  it.each(SHORT_NAME_MEMBER_MATCH_CASES)(
    "hydrates short OCR name $query → $rosterName (video rematch path)",
    ({ query, rosterName, memberId }) => {
      const rows = parsedRowsToRosterReviewRows(
        [
          {
            id: "1",
            ocrName: query,
            memberId: null,
            memberName: null,
            matchConfidence: 0,
            deleted: 0,
          },
        ],
        buildShortNameMatchRoster(),
        "LFgo",
      );

      expect(rows[0]?.memberId).toBe(memberId);
      expect(rows[0]?.memberName).toBe(rosterName);
      expect(rows[0]?.matchConfidence).toBeGreaterThanOrEqual(
        ROSTER_NAME_MATCH_CONFIDENCE_MIN,
      );
      expect(rows[0]?.matchMethod).toBe("fuzzy");
      expect(isRosterRowNameMismatch(rows[0]!)).toBe(false);
    },
  );

  it("hydrates OCR level onto review rows but never profession", () => {
    const rows = parsedRowsToRosterReviewRows(
      [
        {
          id: "1",
          ocrName: "Beta",
          profession: "Warlord",
          memberLevel: 35,
          memberId: null,
          memberName: null,
          matchConfidence: 0,
          deleted: 0,
        },
        {
          id: "2",
          ocrName: "Gamma",
          profession: "Engineer",
          edited: 1,
          memberLevel: 30,
          memberId: null,
          memberName: null,
          matchConfidence: 0,
          deleted: 0,
        },
      ],
      [],
      "LFgo",
    );

    expect(rows[0]?.profession).toBeNull();
    expect(rows[0]?.memberLevel).toBe(35);
    expect(rows[1]?.profession).toBeNull();
    expect(rows[1]?.memberLevel).toBe(30);
  });

  it("flags unmatched and low-confidence roster rows", () => {
    expect(
      isRosterRowNameMismatch({
        memberId: null,
        matchConfidence: 0,
        deleted: 0,
      }),
    ).toBe(true);
    expect(
      isRosterRowNameMismatch({
        memberId: "m1",
        matchConfidence: 0.4,
        matchMethod: "fuzzy",
        deleted: 0,
      }),
    ).toBe(true);
    expect(
      isRosterRowNameMismatch({
        memberId: "m1",
        matchConfidence: 0.95,
        matchMethod: "exact",
        deleted: 0,
      }),
    ).toBe(false);
  });

  it("does not flag unmatched rows when the HQ roster is empty", () => {
    expect(
      isRosterRowNameMismatch(
        {
          memberId: null,
          matchConfidence: 0,
          matchMethod: "none",
          deleted: 0,
        },
        { existingMemberCount: 0 },
      ),
    ).toBe(false);
    const ids = findUnmatchedRosterRowIds(
      [
        {
          id: "a",
          memberId: null,
          matchConfidence: 0,
          matchMethod: "none",
          deleted: 0,
        },
      ],
      { existingMemberCount: 0 },
    );
    expect(ids.size).toBe(0);
  });

  it("collects unmatched row ids", () => {
    const ids = findUnmatchedRosterRowIds([
      {
        id: "a",
        memberId: null,
        matchConfidence: 0,
        deleted: 0,
      },
      {
        id: "b",
        memberId: "m1",
        matchConfidence: 1,
        matchMethod: "exact",
        deleted: 0,
      },
    ]);
    expect(ids.has("a")).toBe(true);
    expect(ids.has("b")).toBe(false);
  });
});
