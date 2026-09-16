import { describe, expect, it } from "vitest";

import type { MemberMatch } from "@/lib/video/member-matcher";
import { dedupeSameScoreOcrTwins } from "@/lib/video/score-ocr-twin-dedupe.shared";

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
});
