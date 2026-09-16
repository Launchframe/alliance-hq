import { describe, expect, it } from "vitest";

import type { MemberMatch } from "@/lib/video/member-matcher";
import {
  dedupeSameScoreOcrTwins,
  scoreboardTwinSimilarity,
  SCORE_OCR_TWIN_SIMILARITY,
} from "@/lib/video/score-ocr-twin-dedupe.shared";

function match(
  memberId: string | null,
  memberName: string | null,
  confidence = memberId ? 1 : 0,
): MemberMatch {
  return {
    ocrName: "",
    memberId,
    memberName,
    confidence,
    matchMethod: memberId ? (confidence === 1 ? "exact" : "fuzzy") : "none",
  };
}

describe("dedupeSameScoreOcrTwins", () => {
  it("merges unmatched same-score Purple OCR twins", () => {
    const deduped = dedupeSameScoreOcrTwins([
      {
        entry: {
          name: "PÜRPŁE PwDx",
          score: "8880000",
          _sourceFrameIndex: 12,
        },
        match: match(null, null),
      },
      {
        entry: {
          name: "PÜRPLe DwvDx",
          score: "8880000",
          _sourceFrameIndex: 14,
        },
        match: match(null, null),
      },
    ]);

    expect(deduped).toHaveLength(1);
  });

  it("keeps a matched keeper over an unmatched fuzzy alias at the same score", () => {
    const memberId = "purple-id";
    const deduped = dedupeSameScoreOcrTwins([
      {
        entry: { name: "Purple", score: "8880000", _sourceFrameIndex: 10 },
        match: match(memberId, "Purple"),
      },
      {
        entry: {
          name: "PÜRPŁE PwDx",
          score: "8880000",
          _sourceFrameIndex: 14,
        },
        match: match(null, null),
      },
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.match.memberId).toBe(memberId);
  });

  it("merges BLAKE OCR twins that share a score", () => {
    const deduped = dedupeSameScoreOcrTwins([
      {
        entry: { name: "BLAKE2BQ9S", score: "9328000", _sourceFrameIndex: 24 },
        match: match(null, null),
      },
      {
        entry: { name: "BLAKEZBogs", score: "9328000", _sourceFrameIndex: 25 },
        match: match("boggle", "BOGGLE", 0.67),
      },
    ]);

    expect(deduped).toHaveLength(1);
  });

  it("does not merge true ties with dissimilar names", () => {
    const deduped = dedupeSameScoreOcrTwins([
      {
        entry: { name: "Alice", score: "1000000", _sourceFrameIndex: 1 },
        match: match("a", "Alice"),
      },
      {
        entry: { name: "Bob", score: "1000000", _sourceFrameIndex: 1 },
        match: match("b", "Bob"),
      },
    ]);

    expect(deduped).toHaveLength(2);
  });

  it("does not merge a same-score prefix tie between two matched members", () => {
    const deduped = dedupeSameScoreOcrTwins([
      {
        entry: { name: "Chris", score: "1000000", _sourceFrameIndex: 1 },
        match: match("chris", "Chris"),
      },
      {
        entry: { name: "Christina", score: "1000000", _sourceFrameIndex: 2 },
        match: match("christina", "Christina"),
      },
    ]);

    expect(deduped).toHaveLength(2);
    expect(deduped.map((row) => row.match.memberId).sort()).toEqual([
      "chris",
      "christina",
    ]);
  });

  it("does not merge unmatched same-score ties that only share a name prefix", () => {
    const deduped = dedupeSameScoreOcrTwins([
      {
        entry: { name: "Happy", score: "0", _sourceFrameIndex: 1 },
        match: match(null, null),
      },
      {
        entry: { name: "Happytokill", score: "0", _sourceFrameIndex: 2 },
        match: match(null, null),
      },
      {
        entry: { name: "Mike", score: "0", _sourceFrameIndex: 3 },
        match: match(null, null),
      },
      {
        entry: { name: "Mikey", score: "0", _sourceFrameIndex: 4 },
        match: match(null, null),
      },
    ]);

    expect(deduped.map((row) => row.entry.name).sort()).toEqual([
      "Happy",
      "Happytokill",
      "Mike",
      "Mikey",
    ]);
  });
});

describe("scoreboardTwinSimilarity", () => {
  it("stays below the merge floor for clean prefix / 1-edit ties", () => {
    expect(scoreboardTwinSimilarity("chris", "christina")).toBeLessThan(
      SCORE_OCR_TWIN_SIMILARITY,
    );
    expect(scoreboardTwinSimilarity("mike", "mikey")).toBeLessThan(
      SCORE_OCR_TWIN_SIMILARITY,
    );
    expect(scoreboardTwinSimilarity("happy", "happytokill")).toBeLessThan(
      SCORE_OCR_TWIN_SIMILARITY,
    );
  });

  it("clears the merge floor for OCR debris twins", () => {
    expect(
      scoreboardTwinSimilarity("purple pwdx", "purple dwvdx"),
    ).toBeGreaterThanOrEqual(SCORE_OCR_TWIN_SIMILARITY);
    expect(
      scoreboardTwinSimilarity("purple", "purple pwdx"),
    ).toBeGreaterThanOrEqual(SCORE_OCR_TWIN_SIMILARITY);
    expect(
      scoreboardTwinSimilarity("blake2bq9s", "blakezbogs"),
    ).toBeGreaterThanOrEqual(SCORE_OCR_TWIN_SIMILARITY);
  });
});
