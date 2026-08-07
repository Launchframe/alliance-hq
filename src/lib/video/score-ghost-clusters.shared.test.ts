import { describe, expect, it } from "vitest";

import type { MemberMatch } from "@/lib/video/member-matcher";
import { dedupeMatchedParseEntries } from "@/lib/video/parse-row-dedup";
import {
  findScoreGhostClusters,
  isLikelyScoreGhostRow,
  scoreGhostRowIdsToDiscard,
  stripUnmatchedScoreGhostEntries,
} from "@/lib/video/score-ghost-clusters.shared";

function match(
  memberId: string | null,
  memberName: string | null,
): MemberMatch {
  return {
    ocrName: "",
    memberId,
    memberName,
    confidence: memberId ? 1 : 0,
    matchMethod: memberId ? "exact" : "none",
  };
}

describe("isLikelyScoreGhostRow", () => {
  const keeper = {
    id: "keeper",
    ocrName: "CAIPIRA",
    score: "7288512",
    memberId: "m1",
    memberName: "CAIPIRA",
    frameIndex: 36,
  };

  it("flags unmatched rows on later frames with a different name", () => {
    expect(
      isLikelyScoreGhostRow(keeper, {
        id: "ghost",
        ocrName: "SAITAMA",
        score: "7288512",
        memberId: null,
        memberName: null,
        frameIndex: 39,
      }),
    ).toBe(true);
  });

  it("rejects same-frame rows (likely tied scores)", () => {
    expect(
      isLikelyScoreGhostRow(keeper, {
        id: "tie",
        ocrName: "OTHER PLAYER",
        score: "7288512",
        memberId: null,
        memberName: null,
        frameIndex: 36,
      }),
    ).toBe(false);
  });

  it("rejects rows on earlier or equal frames", () => {
    expect(
      isLikelyScoreGhostRow(keeper, {
        id: "earlier",
        ocrName: "NOISE",
        score: "7288512",
        memberId: null,
        memberName: null,
        frameIndex: 35,
      }),
    ).toBe(false);
  });

  it("rejects keeper OCR aliases on later frames", () => {
    expect(
      isLikelyScoreGhostRow(keeper, {
        id: "alias",
        ocrName: "CAIPIR",
        score: "7288512",
        memberId: null,
        memberName: null,
        frameIndex: 37,
      }),
    ).toBe(false);
  });

  it("requires both frame indices", () => {
    expect(
      isLikelyScoreGhostRow(
        { ...keeper, frameIndex: null },
        {
          id: "ghost",
          ocrName: "SAITAMA",
          score: "7288512",
          memberId: null,
          memberName: null,
          frameIndex: 39,
        },
      ),
    ).toBe(false);
  });
});

describe("findScoreGhostClusters", () => {
  it("detects one matched keeper and unmatched OCR ghosts for the same score", () => {
    const clusters = findScoreGhostClusters([
      {
        id: "keeper",
        ocrName: "CAIPIRA",
        score: "7,288,512",
        memberId: "m1",
        memberName: "CAIPIRA",
        frameIndex: 36,
      },
      {
        id: "ghost-1",
        ocrName: "SAITAMA",
        score: "7288512",
        memberId: null,
        memberName: null,
        frameIndex: 39,
      },
      {
        id: "ghost-2",
        ocrName: "SAW TMA",
        score: "7288512",
        memberId: null,
        memberName: null,
        frameIndex: 40,
      },
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({
      normalizedScore: "7288512",
      keeperRowId: "keeper",
      ghostRowIds: ["ghost-1", "ghost-2"],
    });
  });

  it("ignores tied players captured on the same frame", () => {
    expect(
      findScoreGhostClusters([
        {
          id: "keeper",
          ocrName: "PLAYER A",
          score: "100",
          memberId: "m1",
          memberName: "PLAYER A",
          frameIndex: 10,
        },
        {
          id: "tie",
          ocrName: "PLAYER B",
          score: "100",
          memberId: null,
          memberName: null,
          frameIndex: 10,
        },
      ]),
    ).toHaveLength(0);
  });

  it("ignores clusters with multiple matched members (duplicate-member issue)", () => {
    expect(
      findScoreGhostClusters([
        {
          id: "a",
          ocrName: "A",
          score: "100",
          memberId: "m1",
          memberName: "A",
          frameIndex: 1,
        },
        {
          id: "b",
          ocrName: "B",
          score: "100",
          memberId: "m2",
          memberName: "B",
          frameIndex: 2,
        },
        {
          id: "ghost",
          ocrName: "noise",
          score: "100",
          memberId: null,
          memberName: null,
          frameIndex: 3,
        },
      ]),
    ).toHaveLength(0);
  });

  it("ignores score groups with no matched keeper", () => {
    expect(
      findScoreGhostClusters([
        {
          id: "a",
          ocrName: "A",
          score: "100",
          memberId: null,
          memberName: null,
          frameIndex: 1,
        },
        {
          id: "b",
          ocrName: "B",
          score: "100",
          memberId: null,
          memberName: null,
          frameIndex: 2,
        },
      ]),
    ).toHaveLength(0);
  });

  it("does not cluster when frame indices are missing", () => {
    expect(
      findScoreGhostClusters([
        {
          id: "keeper",
          ocrName: "CAIPIRA",
          score: "7288512",
          memberId: "m1",
          memberName: "CAIPIRA",
        },
        {
          id: "ghost",
          ocrName: "SAITAMA",
          score: "7288512",
          memberId: null,
          memberName: null,
        },
      ]),
    ).toHaveLength(0);
  });
});

describe("scoreGhostRowIdsToDiscard", () => {
  it("returns all ghost row ids across clusters", () => {
    const ids = scoreGhostRowIdsToDiscard(
      findScoreGhostClusters([
        {
          id: "k1",
          ocrName: "CAIPIRA",
          score: "7288512",
          memberId: "m1",
          memberName: "CAIPIRA",
          frameIndex: 36,
        },
        {
          id: "g1",
          ocrName: "SAITAMA",
          score: "7288512",
          memberId: null,
          memberName: null,
          frameIndex: 39,
        },
        {
          id: "k2",
          ocrName: "March2104",
          score: "9822050",
          memberId: "m2",
          memberName: "March2104",
          frameIndex: 20,
        },
        {
          id: "g2",
          ocrName: "dwdX",
          score: "9822050",
          memberId: null,
          memberName: null,
          frameIndex: 22,
        },
      ]),
    );
    expect(ids).toEqual(new Set(["g1", "g2"]));
  });
});

describe("stripUnmatchedScoreGhostEntries", () => {
  it("removes unmatched rows that share a score with a single matched row", () => {
    const memberId = "6a034623adea49a60e0417d6";
    const stripped = stripUnmatchedScoreGhostEntries([
      {
        entry: { name: "CAIPIRA", score: "7288512", _sourceFrameIndex: 36 },
        match: match(memberId, "CAIPIRA"),
      },
      {
        entry: { name: "SAITAMA", score: "7288512", _sourceFrameIndex: 39 },
        match: match(null, null),
      },
      {
        entry: { name: "SAW TMA", score: "7288512", _sourceFrameIndex: 40 },
        match: match(null, null),
      },
    ]);

    expect(stripped.map((row) => row.entry.name)).toEqual(["CAIPIRA"]);
  });

  it("keeps same-frame unmatched ties", () => {
    const stripped = stripUnmatchedScoreGhostEntries([
      {
        entry: { name: "PLAYER A", score: "100", _sourceFrameIndex: 5 },
        match: match("m1", "PLAYER A"),
      },
      {
        entry: { name: "PLAYER B", score: "100", _sourceFrameIndex: 5 },
        match: match(null, null),
      },
    ]);

    expect(stripped.map((row) => row.entry.name)).toEqual([
      "PLAYER A",
      "PLAYER B",
    ]);
  });

  it("composes with dedupeMatchedParseEntries for matched alias rows", () => {
    const memberId = "6a034427f086fe4280e11c86";
    const matchedRows = [
      {
        entry: { name: "EG DIG", score: "7424240", _sourceFrameIndex: 33 },
        match: match(memberId, "EG Sie"),
      },
      {
        entry: { name: "EG Sie", score: "7424240", _sourceFrameIndex: 34 },
        match: match(memberId, "EG Sie"),
      },
      {
        entry: { name: "noise", score: "7424240", _sourceFrameIndex: 35 },
        match: match(null, null),
      },
    ];
    const rows = stripUnmatchedScoreGhostEntries(
      dedupeMatchedParseEntries(matchedRows),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entry.name).toBe("EG Sie");
  });
});
