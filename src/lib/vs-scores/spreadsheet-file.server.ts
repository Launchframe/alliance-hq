import "server-only";

import ExcelJS from "exceljs";

import {
  cellGridFromCsvMatrix,
  parseVsSpreadsheetTable,
  VS_SPREADSHEET_MAX_BYTES,
  type VsSpreadsheetParseResult,
} from "@/lib/vs-scores/spreadsheet-import.shared";

export { VS_SPREADSHEET_MAX_BYTES };

export type VsSpreadsheetFileKind = "csv" | "xlsx";

export class VsSpreadsheetFileError extends Error {
  constructor(
    public readonly code:
      | "unsupported_type"
      | "too_large"
      | "no_rows"
      | "too_many_rows"
      | "parse_failed",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "VsSpreadsheetFileError";
  }
}

function extensionOf(fileName: string): string {
  const base = fileName.trim().toLowerCase();
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot) : "";
}

export function detectVsSpreadsheetKind(
  fileName: string,
  mimeType?: string | null,
): VsSpreadsheetFileKind {
  const ext = extensionOf(fileName);
  const mime = (mimeType ?? "").toLowerCase().trim();
  if (ext === ".csv" || mime === "text/csv" || mime === "application/csv") {
    return "csv";
  }
  if (
    ext === ".xlsx" ||
    mime ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "application/octet-stream"
  ) {
    if (ext === ".xlsx" || mime.includes("spreadsheetml")) return "xlsx";
  }
  if (ext === ".xls") {
    throw new VsSpreadsheetFileError("unsupported_type");
  }
  if (ext === ".xlsx") return "xlsx";
  throw new VsSpreadsheetFileError("unsupported_type");
}

/** Minimal RFC 4180 CSV reader (quotes, CRLF/LF, UTF-8 BOM). */
export function parseCsvToCells(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    if (ch === "\r") {
      continue;
    }
    field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export async function worksheetToCells(
  buffer: Buffer,
): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  // exceljs typings accept Buffer | ArrayBuffer | stream
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const cells: string[][] = [];
  const maxCol = Math.max(sheet.actualColumnCount || 0, sheet.columnCount || 0, 1);
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const line: string[] = [];
    for (let c = 1; c <= maxCol; c++) {
      line.push(cellValueToText(row.getCell(c).value));
    }
    // Drop trailing empty cells so header detection stays tight.
    while (line.length > 0 && line[line.length - 1] === "") line.pop();
    while (cells.length < rowNumber - 1) cells.push([]);
    cells[rowNumber - 1] = line;
  });
  return cells;
}

function cellValueToText(value: ExcelJS.CellValue | undefined): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text ?? "").join("");
    }
    if ("text" in value && typeof value.text === "string") {
      return value.text;
    }
    if ("result" in value && value.result != null) {
      return String(value.result);
    }
    if ("hyperlink" in value && typeof value.text === "string") {
      return value.text;
    }
  }
  return String(value);
}

export async function parseVsSpreadsheetFile(input: {
  buffer: Buffer;
  fileName: string;
  mimeType?: string | null;
  now?: Date;
}): Promise<VsSpreadsheetParseResult> {
  if (input.buffer.byteLength > VS_SPREADSHEET_MAX_BYTES) {
    throw new VsSpreadsheetFileError("too_large");
  }
  const kind = detectVsSpreadsheetKind(input.fileName, input.mimeType);
  let cells: string[][];
  try {
    if (kind === "csv") {
      cells = parseCsvToCells(input.buffer.toString("utf8"));
    } else {
      cells = await worksheetToCells(input.buffer);
    }
  } catch (error) {
    if (error instanceof VsSpreadsheetFileError) throw error;
    throw new VsSpreadsheetFileError("parse_failed");
  }

  const parsed = parseVsSpreadsheetTable(cellGridFromCsvMatrix(cells), {
    fileName: input.fileName,
    now: input.now,
  });
  if (parsed.rows.length === 0) {
    throw new VsSpreadsheetFileError("no_rows");
  }
  if (parsed.warnings.includes("truncated_to_max_rows")) {
    throw new VsSpreadsheetFileError("too_many_rows");
  }
  return parsed;
}
