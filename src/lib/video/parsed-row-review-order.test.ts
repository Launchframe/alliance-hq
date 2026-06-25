import { describe, expect, it } from "vitest";

import {
  compareParsedRowsForReview,
  mergeParsedRowInReviewOrder,
  reviewRowPrimarySortKey,
} from "@/lib/video/parsed-row-review-order";

describe("reviewRowPrimarySortKey", () => {
  it("uses allianceRank for roster video targets", () => {
    expect(reviewRowPrimarySortKey("member-roster-video")).toBe("allianceRank");
  });

  it("uses rank for vs-performance and podium targets", () => {
    expect(reviewRowPrimarySortKey("vs-performance")).toBe("rank");
    expect(reviewRowPrimarySortKey("alliance-star")).toBe("rank");
  });

  it("returns null for linear score targets ordered by frameIndex", () => {
    expect(reviewRowPrimarySortKey("desert-storm")).toBeNull();
  });
});

describe("compareParsedRowsForReview", () => {
  it("sorts by rank then frameIndex for vs-performance", () => {
    const rows = [
      { rank: 2, frameIndex: 0 },
      { rank: 1, frameIndex: 5 },
      { rank: null, frameIndex: -1 },
    ];
    rows.sort((a, b) => compareParsedRowsForReview(a, b, "vs-performance"));
    expect(rows.map((row) => row.rank)).toEqual([1, 2, null]);
  });

  it("sorts by frameIndex when rank is unset for all rows", () => {
    const rows = [
      { rank: null, frameIndex: 3 },
      { rank: null, frameIndex: -1 },
      { rank: null, frameIndex: 1 },
    ];
    rows.sort((a, b) => compareParsedRowsForReview(a, b, "desert-storm"));
    expect(rows.map((row) => row.frameIndex)).toEqual([-1, 1, 3]);
  });
});

describe("mergeParsedRowInReviewOrder", () => {
  it("inserts a manual row at the start when rank is below existing rows", () => {
    const merged = mergeParsedRowInReviewOrder(
      [
        { id: "a", rank: 1, frameIndex: 0 },
        { id: "b", rank: 2, frameIndex: 1 },
      ],
      { id: "new", rank: 0, frameIndex: -1 },
      "vs-performance",
    );
    expect(merged.map((row) => row.id)).toEqual(["new", "a", "b"]);
  });
});
