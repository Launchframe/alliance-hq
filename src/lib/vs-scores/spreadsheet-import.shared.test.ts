import { describe, expect, it } from "vitest";

import {
  detectVsSpreadsheetPeriodAndDate,
  parseVsSpreadsheetTable,
  VS_SPREADSHEET_MAX_ROWS,
} from "./spreadsheet-import.shared";

describe("parseVsSpreadsheetTable", () => {
  it("parses a Snapz-shaped weekly report with special-character names", () => {
    const cells = [
      ["VS Weekly Report - Week of 2026-09-28"],
      ["2026-10-04  16:11   •   4 players"],
      [],
      ["Rank", "Name", "Points"],
      ["1", "Juicepintos", "367015969"],
      ["2", "QiuLion 獅", "258504208"],
      ["3", "ʳʰᶦⁿᵒ", "238978585"],
      ["4", "[TAG] snãpz", "96,664,504"],
    ];
    const result = parseVsSpreadsheetTable(cells, {
      fileName: "Weekly Total - 2026-10-03.xlsx",
      now: new Date("2026-10-06T12:00:00.000Z"),
    });
    expect(result.detectedPeriod).toBe("weekly");
    expect(result.detectedRecordedDate).toBe("2026-10-04");
    expect(result.headerRowIndex).toBe(3);
    expect(result.rows).toEqual([
      { rank: 1, name: "Juicepintos", score: 367015969 },
      { rank: 2, name: "QiuLion 獅", score: 258504208 },
      { rank: 3, name: "ʳʰᶦⁿᵒ", score: 238978585 },
      { rank: 4, name: "[TAG] snãpz", score: 96664504 },
    ]);
  });

  it("parses headerless CSV using positional columns", () => {
    const cells = [
      ["1", "Alpha", "1000"],
      ["2", "Beta", "900"],
    ];
    const result = parseVsSpreadsheetTable(cells, {
      fileName: "scores.csv",
      now: new Date("2026-10-06T12:00:00.000Z"),
    });
    expect(result.warnings).toContain("no_header_used_positional");
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({ rank: 1, name: "Alpha", score: 1000 });
  });

  it("accepts commander/score header aliases and comma-formatted scores", () => {
    const cells = [
      ["Commander", "Score"],
      ["Smith, Jr.", "7,200,000"],
      ["ṄØX", "1.234.567"],
    ];
    const result = parseVsSpreadsheetTable(cells);
    expect(result.rows).toEqual([
      { rank: null, name: "Smith, Jr.", score: 7_200_000 },
      { rank: null, name: "ṄØX", score: 1_234_567 },
    ]);
  });

  it("skips blank, total, and invalid score rows", () => {
    const cells = [
      ["Rank", "Name", "Points"],
      ["1", "Ok", "100"],
      ["", "", ""],
      ["", "Total", "999"],
      ["2", "Bad", "not-a-number"],
      ["3", "Also", "200"],
    ];
    const result = parseVsSpreadsheetTable(cells);
    expect(result.rows.map((r) => r.name)).toEqual(["Ok", "Also"]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        "skipped_blank",
        "skipped_header_like",
        "skipped_invalid_score",
      ]),
    );
  });

  it("truncates at the commit max row count", () => {
    const cells = [
      ["Rank", "Name", "Points"],
      ...Array.from({ length: VS_SPREADSHEET_MAX_ROWS + 5 }, (_, i) => [
        String(i + 1),
        `Player ${i + 1}`,
        String(1000 - i),
      ]),
    ];
    const result = parseVsSpreadsheetTable(cells);
    expect(result.rows).toHaveLength(VS_SPREADSHEET_MAX_ROWS);
    expect(result.warnings).toContain("truncated_to_max_rows");
  });
});

describe("detectVsSpreadsheetPeriodAndDate", () => {
  it("maps Week of Monday to week-ending Sunday", () => {
    const detected = detectVsSpreadsheetPeriodAndDate({
      cells: [["VS Weekly Report - Week of 2026-09-28"]],
      fileName: "Weekly Total - 2026-10-03.xlsx",
    });
    expect(detected).toEqual({
      period: "weekly",
      recordedDate: "2026-10-04",
    });
  });

  it("treats a Saturday filename date as the following Sunday", () => {
    const detected = detectVsSpreadsheetPeriodAndDate({
      cells: [["Rank", "Name", "Points"]],
      fileName: "Weekly Total - 2026-10-03.xlsx",
    });
    expect(detected).toEqual({
      period: "weekly",
      recordedDate: "2026-10-04",
    });
  });

  it("detects a daily date from the filename when the sheet has no dates", () => {
    const detected = detectVsSpreadsheetPeriodAndDate({
      cells: [
        ["Rank", "Name", "Points"],
        ["1", "Alpha", "100"],
      ],
      fileName: "VS Daily - 2026-10-01.csv",
    });
    expect(detected).toEqual({
      period: "daily",
      recordedDate: "2026-10-01",
    });
  });

  it("filename-only Week of detection matches the client dialog hint path", () => {
    const detected = detectVsSpreadsheetPeriodAndDate({
      cells: [],
      fileName: "report Week of 2026-09-28.xlsx",
    });
    expect(detected).toEqual({
      period: "weekly",
      recordedDate: "2026-10-04",
    });
  });
});
