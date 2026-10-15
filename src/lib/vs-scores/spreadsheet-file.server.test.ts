import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  detectVsSpreadsheetKind,
  parseCsvToCells,
  parseVsSpreadsheetFile,
  VsSpreadsheetFileError,
  worksheetToCells,
} from "./spreadsheet-file.server";

async function buildSnapzLikeXlsx(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Weekly");
  sheet.getCell("A1").value = "VS Weekly Report - Week of 2026-09-28";
  sheet.getCell("A2").value = "2026-10-04  16:11   •   3 players";
  sheet.getCell("A4").value = "Rank";
  sheet.getCell("B4").value = "Name";
  sheet.getCell("C4").value = "Points";
  sheet.getCell("A5").value = 1;
  sheet.getCell("B5").value = "Juicepintos";
  sheet.getCell("C5").value = 367015969;
  sheet.getCell("A6").value = 2;
  sheet.getCell("B6").value = "QiuLion 獅";
  sheet.getCell("C6").value = 258504208;
  sheet.getCell("A7").value = 3;
  sheet.getCell("B7").value = "ʳʰᶦⁿᵒ";
  sheet.getCell("C7").value = 238978585;
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

describe("spreadsheet-file.server", () => {
  it("detects csv and xlsx kinds and rejects .xls", () => {
    expect(detectVsSpreadsheetKind("scores.csv", "text/csv")).toBe("csv");
    expect(
      detectVsSpreadsheetKind(
        "weekly.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe("xlsx");
    expect(() => detectVsSpreadsheetKind("old.xls")).toThrow(
      VsSpreadsheetFileError,
    );
  });

  it("parses CSV with BOM, quotes, and CRLF", () => {
    const csv =
      "\uFEFFRank,Name,Points\r\n1,\"Smith, Jr.\",\"7,200,000\"\r\n2,NOX,1234567\r\n";
    const cells = parseCsvToCells(csv);
    expect(cells[0]).toEqual(["Rank", "Name", "Points"]);
    expect(cells[1]).toEqual(["1", "Smith, Jr.", "7,200,000"]);
    expect(cells[2]).toEqual(["2", "NOX", "1234567"]);
  });

  it("reads an xlsx worksheet into a cell grid", async () => {
    const buffer = await buildSnapzLikeXlsx();
    const cells = await worksheetToCells(buffer);
    expect(cells[0]?.[0]).toContain("Week of 2026-09-28");
    expect(cells[3]?.slice(0, 3)).toEqual(["Rank", "Name", "Points"]);
    expect(cells[4]?.[1]).toBe("Juicepintos");
  });

  it("parses a Snapz-shaped xlsx end-to-end", async () => {
    const buffer = await buildSnapzLikeXlsx();
    const parsed = await parseVsSpreadsheetFile({
      buffer,
      fileName: "Weekly Total - 2026-10-03.xlsx",
      now: new Date("2026-10-06T12:00:00.000Z"),
    });
    expect(parsed.detectedPeriod).toBe("weekly");
    expect(parsed.detectedRecordedDate).toBe("2026-10-04");
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows[2]?.name).toBe("ʳʰᶦⁿᵒ");
  });

  it("rejects empty spreadsheets", async () => {
    await expect(
      parseVsSpreadsheetFile({
        buffer: Buffer.from("Rank,Name,Points\n"),
        fileName: "empty.csv",
      }),
    ).rejects.toMatchObject({ code: "no_rows" });
  });
});
