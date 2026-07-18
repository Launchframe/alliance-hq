import { describe, expect, it } from "vitest";

import {
  compareParsedRowsForReview,
  mergeParsedRowInReviewOrder,
  reviewRowPrimarySortKey,
  sortParsedRowsForInitialReview,
  sortsInitialReviewByScoreDesc,
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

describe("sortsInitialReviewByScoreDesc", () => {
  it("is true only for desert-storm", () => {
    expect(sortsInitialReviewByScoreDesc("desert-storm")).toBe(true);
    expect(sortsInitialReviewByScoreDesc("canyon-storm")).toBe(false);
    expect(sortsInitialReviewByScoreDesc("vs-performance")).toBe(false);
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

  it("sorts by frameIndex when rank is unset for all rows (edit/merge path)", () => {
    const rows = [
      { rank: null, frameIndex: 3 },
      { rank: null, frameIndex: -1 },
      { rank: null, frameIndex: 1 },
    ];
    rows.sort((a, b) => compareParsedRowsForReview(a, b, "desert-storm"));
    expect(rows.map((row) => row.frameIndex)).toEqual([-1, 1, 3]);
  });
});

describe("sortParsedRowsForInitialReview", () => {
  it("sorts desert-storm by score descending on load", () => {
    const sorted = sortParsedRowsForInitialReview(
      [
        { id: "a", score: "100", frameIndex: 0 },
        { id: "b", score: "1,250", frameIndex: 2 },
        { id: "c", score: "500", frameIndex: 1 },
        { id: "d", score: "", frameIndex: 3 },
      ],
      "desert-storm",
    );
    expect(sorted.map((row) => row.id)).toEqual(["b", "c", "a", "d"]);
  });

  it("does not use score order for canyon-storm load", () => {
    const sorted = sortParsedRowsForInitialReview(
      [
        { id: "a", score: "100", rank: null, frameIndex: 2 },
        { id: "b", score: "999", rank: null, frameIndex: 0 },
      ],
      "canyon-storm",
    );
    expect(sorted.map((row) => row.id)).toEqual(["b", "a"]);
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

  it("does not reshuffle desert-storm rows by score on merge", () => {
    const merged = mergeParsedRowInReviewOrder(
      [
        { id: "a", rank: null, frameIndex: 0 },
        { id: "b", rank: null, frameIndex: 1 },
      ],
      { id: "new", rank: null, frameIndex: -1 },
      "desert-storm",
    );
    // Manual rows use frameIndex -1; merge keeps rank/frameIndex rules, not score.
    expect(merged.map((row) => row.id)).toEqual(["new", "a", "b"]);
  });
});
