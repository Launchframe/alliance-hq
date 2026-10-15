import { describe, expect, it } from "vitest";

import {
  buildMemberIndex,
  matchMemberName,
} from "@/lib/video/member-matcher";
import { dedupeMatchedParseEntries } from "@/lib/video/parse-row-dedup";
import { dedupeSameScoreOcrTwins } from "@/lib/video/score-ocr-twin-dedupe.shared";
import { parseVsSpreadsheetTable } from "@/lib/vs-scores/spreadsheet-import.shared";

describe("spreadsheet import name matching", () => {
  it("matches special-character and tagged names through the shared matcher", () => {
    const parsed = parseVsSpreadsheetTable(
      [
        ["Rank", "Name", "Points"],
        ["1", "ʳʰᶦⁿᵒ", "1000"],
        ["2", "[TAG] snãpz", "900"],
        ["3", "QiuLion 獅", "800"],
      ],
      { fileName: "Weekly Total - 2026-10-03.xlsx" },
    );
    const index = buildMemberIndex([
      { id: "m1", current_name: "ʳʰᶦⁿᵒ" },
      { id: "m2", current_name: "snãpz" },
      { id: "m3", current_name: "QiuLion 獅" },
    ]);
    const matches = parsed.rows.map((row) =>
      matchMemberName(row.name, index, { allianceTag: "TAG" }),
    );
    expect(matches.map((m) => m.memberId)).toEqual(["m1", "m2", "m3"]);
    expect(matches.every((m) => m.matchMethod !== "none")).toBe(true);
  });

  it("keeps same-score names that OCR twin collapse would discard", () => {
    // Shared stem + OCR remainder debris — collapses under video OCR rules.
    const names = ["blake2bq9s", "blakezbogs"];
    const matchedRows = names.map((name, index) => ({
      entry: {
        name,
        score: 5000,
        rank: index + 1,
        scoreConflict: false,
      },
      match: {
        ocrName: name,
        memberId: null,
        memberName: null,
        confidence: 0,
        matchMethod: "none" as const,
      },
    }));
    expect(dedupeSameScoreOcrTwins(matchedRows, null)).toHaveLength(1);
    // Spreadsheet import only runs member-id dedupe, so both rows remain.
    const kept = dedupeMatchedParseEntries(matchedRows, null);
    expect(kept.map((row) => row.entry.name)).toEqual(names);
  });
});
