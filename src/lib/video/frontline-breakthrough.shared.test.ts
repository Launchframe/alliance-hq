import { describe, expect, it } from "vitest";

import type { MatchedParseEntry } from "@/lib/video/parse-row-dedup";
import type { MemberMatch } from "@/lib/video/member-matcher";
import type { OcrEntry } from "@/lib/video/normalize-rows";
import {
  collapseFrontlineEntries,
  dedupeFrontlineMatchedEntries,
  extractFrontlineEntries,
  frontlineConflictRowIds,
  frontlinePositiveInteger,
  frontlineRowIssues,
  normalizeFrontlineScore,
} from "@/lib/video/frontline-breakthrough.shared";

describe("normalizeFrontlineScore", () => {
  it("normalizes prefixed and grouped integer scores", () => {
    expect(normalizeFrontlineScore("x2704")).toBe("2704");
    expect(normalizeFrontlineScore("x2,704")).toBe("2704");
    expect(normalizeFrontlineScore("2704")).toBe("2704");
    expect(normalizeFrontlineScore("0")).toBe("0");
  });

  it("rejects negative, fractional, infinite, and unsafe values", () => {
    expect(normalizeFrontlineScore("-1")).toBeNull();
    expect(normalizeFrontlineScore("1.5")).toBeNull();
    expect(normalizeFrontlineScore(1.001)).toBeNull();
    expect(normalizeFrontlineScore("1.001")).toBe("1001");
    expect(normalizeFrontlineScore(Infinity)).toBeNull();
    expect(normalizeFrontlineScore("99999999999999999999")).toBeNull();
    expect(normalizeFrontlineScore("abc")).toBeNull();
    expect(normalizeFrontlineScore(null)).toBeNull();
    expect(normalizeFrontlineScore(undefined)).toBeNull();
  });
});

describe("frontlinePositiveInteger", () => {
  it("accepts positive integers including values above 5", () => {
    expect(frontlinePositiveInteger(1)).toBe(1);
    expect(frontlinePositiveInteger(5)).toBe(5);
    expect(frontlinePositiveInteger(12)).toBe(12);
    expect(frontlinePositiveInteger("7")).toBe(7);
  });

  it("rejects missing, zero, negative, and fractional values", () => {
    expect(frontlinePositiveInteger(null)).toBeNull();
    expect(frontlinePositiveInteger(undefined)).toBeNull();
    expect(frontlinePositiveInteger(0)).toBeNull();
    expect(frontlinePositiveInteger(-2)).toBeNull();
    expect(frontlinePositiveInteger(1.5)).toBeNull();
    expect(frontlinePositiveInteger("3.5")).toBeNull();
  });
});

describe("extractFrontlineEntries", () => {
  it("extracts entries with stage, score, and rank from the alliance tab", () => {
    const entries = extractFrontlineEntries({
      selectedTab: "alliance",
      entries: [
        { name: "Alpha One", stage: 5, score: "x2670", rank: 1 },
        { name: "Beta Two", stage: 4, score: "x1,234", rank: 7 },
      ],
    });
    expect(entries).toEqual([
      { name: "Alpha One", score: "2670", rank: 1, frontlineStage: 5 },
      { name: "Beta Two", score: "1234", rank: 7, frontlineStage: 4 },
    ]);
  });

  it("returns no entries for non-alliance tabs", () => {
    expect(
      extractFrontlineEntries({
        selectedTab: "warzone",
        entries: [{ name: "Alpha", stage: 5, score: "x100", rank: 1 }],
      }),
    ).toEqual([]);
  });

  it("keeps full Unicode names unchanged", () => {
    const entries = extractFrontlineEntries({
      selectedTab: "alliance",
      entries: [{ name: "Ñömé Ünïçödé 名字", stage: 3, score: "x500", rank: 4 }],
    });
    expect(entries[0]?.name).toBe("Ñömé Ünïçödé 名字");
  });

  it("maps unreadable stage and rank to null/omitted", () => {
    const entries = extractFrontlineEntries({
      selectedTab: "alliance",
      entries: [{ name: "Alpha", stage: null, score: "x900", rank: null }],
    });
    expect(entries).toEqual([
      { name: "Alpha", score: "900", frontlineStage: null },
    ]);
  });

  it("drops entries with invalid or missing score", () => {
    const entries = extractFrontlineEntries({
      selectedTab: "alliance",
      entries: [
        { name: "Alpha", stage: 5, score: "", rank: 1 },
        { name: "Beta", stage: 5, score: "nope", rank: 2 },
      ],
    });
    expect(entries).toEqual([]);
  });
});

describe("collapseFrontlineEntries", () => {
  it("merges identical name+tuple rows across frames", () => {
    const { entries, unresolvedConflicts } = collapseFrontlineEntries([
      { name: "Alpha", score: "100", rank: 3, frontlineStage: 5, _sourceFrameIndex: 2 },
      { name: "Alpha", score: "100", rank: 3, frontlineStage: 5, _sourceFrameIndex: 0 },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?._sourceFrameIndex).toBe(0);
    expect(unresolvedConflicts).toEqual([]);
    expect(entries[0]?.scoreConflict).toBe(false);
  });

  it("preserves changed stage or rank as separate rows and flags a conflict", () => {
    const { entries, unresolvedConflicts } = collapseFrontlineEntries([
      { name: "Alpha", score: "100", rank: 3, frontlineStage: 5 },
      { name: "Alpha", score: "100", rank: 4, frontlineStage: 5 },
      { name: "Alpha", score: "100", rank: 3, frontlineStage: 4 },
    ]);
    expect(entries).toHaveLength(3);
    expect(unresolvedConflicts).toEqual(["alpha"]);
    expect(entries.every((entry) => entry.scoreConflict)).toBe(true);
  });
});

function matched(
  entry: OcrEntry,
  memberId: string | null,
  confidence = 1,
): MatchedParseEntry {
  const match = { memberId, memberName: "M", confidence } as MemberMatch;
  return { entry, match };
}

describe("dedupeFrontlineMatchedEntries", () => {
  it("merges rows with the same matched identity and tuple", () => {
    const rows = dedupeFrontlineMatchedEntries([
      matched({ name: "Alpha", score: "100", rank: 1, frontlineStage: 5, _sourceFrameIndex: 3 }, "m1"),
      matched({ name: "Alpha", score: "100", rank: 1, frontlineStage: 5, _sourceFrameIndex: 1 }, "m1"),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entry._sourceFrameIndex).toBe(1);
  });

  it("does not merge different matched member ids", () => {
    const rows = dedupeFrontlineMatchedEntries([
      matched({ name: "Alpha", score: "100", frontlineStage: 5 }, "m1"),
      matched({ name: "Alpha", score: "100", frontlineStage: 5 }, "m2"),
    ]);
    expect(rows).toHaveLength(2);
  });
});

describe("frontlineRowIssues", () => {
  it("flags missing stage and invalid score", () => {
    expect(frontlineRowIssues({ frontlineStage: null, score: "x1.5", rank: 1 })).toEqual([
      "stage",
      "score",
    ]);
  });

  it("flags invalid rank but allows blank rank", () => {
    expect(
      frontlineRowIssues({ frontlineStage: 5, score: "100", rank: 0 }),
    ).toEqual(["rank"]);
    expect(
      frontlineRowIssues({ frontlineStage: 5, score: "100", rank: null }),
    ).toEqual([]);
  });
});

describe("frontlineConflictRowIds", () => {
  it("marks rows for the same member with differing tuples", () => {
    const conflicts = frontlineConflictRowIds([
      { id: "a", ocrName: "Alpha", memberId: "m1", frontlineStage: 5, score: "100", rank: 1 },
      { id: "b", ocrName: "Alpha", memberId: "m1", frontlineStage: 4, score: "100", rank: 1 },
      { id: "c", ocrName: "Beta", memberId: "m2", frontlineStage: 2, score: "50", rank: 2 },
    ]);
    expect([...conflicts].sort()).toEqual(["a", "b"]);
  });

  it("leaves identical tuples conflict-free", () => {
    const conflicts = frontlineConflictRowIds([
      { id: "a", ocrName: "Alpha", memberId: "m1", frontlineStage: 5, score: "100", rank: 1 },
      { id: "b", ocrName: "Alpha", memberId: "m1", frontlineStage: 5, score: "100", rank: 1 },
    ]);
    expect(conflicts.size).toBe(0);
  });
});
