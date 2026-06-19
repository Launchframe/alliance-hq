import { describe, expect, it } from "vitest";

import type { MemberMatch } from "@/lib/video/member-matcher";
import { dedupeMatchedParseEntries } from "@/lib/video/parse-row-dedup";

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

describe("dedupeMatchedParseEntries", () => {
  it("merges OCR variants that matched the same member with the same score", () => {
    const memberId = "6a034423bf80a75dc27eb9c9";
    const deduped = dedupeMatchedParseEntries([
      {
        entry: { name: "SlAcKin", score: "19790101", _sourceFrameIndex: 13 },
        match: match(memberId, "Slackin"),
      },
      {
        entry: { name: "SIAcKin", score: "19790101", _sourceFrameIndex: 14 },
        match: match(memberId, "Slackin"),
      },
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.entry.name).toBe("SlAcKin");
    expect(deduped[0]?.entry.score).toBe("19790101");
    expect(deduped[0]?.entry._sourceFrameIndex).toBe(13);
  });

  it("keeps rows with the same member but different scores", () => {
    const memberId = "m1";
    const deduped = dedupeMatchedParseEntries([
      {
        entry: { name: "Freddy", score: "100" },
        match: match(memberId, "Freddy"),
      },
      {
        entry: { name: "Freddy", score: "200" },
        match: match(memberId, "Freddy"),
      },
    ]);

    expect(deduped).toHaveLength(2);
  });

  it("leaves unmatched rows untouched even when scores match", () => {
    const deduped = dedupeMatchedParseEntries([
      {
        entry: { name: "Via Cindy DwDx", score: "36800303", _sourceFrameIndex: 1 },
        match: match(null, null),
      },
      {
        entry: { name: "Via CindyDwDx", score: "36800303", _sourceFrameIndex: 2 },
        match: match(null, null),
      },
    ]);

    expect(deduped).toHaveLength(2);
  });

  it("dedupes EG DIG / EG Sie style alias matches", () => {
    const memberId = "6a034427f086fe4280e11c86";
    const deduped = dedupeMatchedParseEntries([
      {
        entry: { name: "EG DIG", score: "7424240", _sourceFrameIndex: 33 },
        match: match(memberId, "EG Sie"),
      },
      {
        entry: { name: "EG Sie", score: "7424240", _sourceFrameIndex: 34 },
        match: match(memberId, "EG Sie"),
      },
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.entry.name).toBe("EG Sie");
  });
});
