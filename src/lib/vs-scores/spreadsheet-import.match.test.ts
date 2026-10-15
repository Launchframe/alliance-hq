import { describe, expect, it } from "vitest";

import {
  buildMemberIndex,
  matchMemberName,
} from "@/lib/video/member-matcher";
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
});
