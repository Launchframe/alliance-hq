import {
  parseVsScore,
  validateVsPeriod,
  vsWeekEndingDate,
  type VsPeriod,
} from "@/lib/vs-scores/evidence.shared";
import {
  defaultVsPerformanceRecordedDate,
  isValidVsPerformanceRecordedDate,
} from "@/lib/video/vs-recorded-date.shared";
import { getServerDayOfWeek } from "@/lib/trains/game-time";

/** Hard cap shared with {@link commitReviewedVsScores}. */
export const VS_SPREADSHEET_MAX_ROWS = 300;

/** Upload size cap for CSV / XLSX imports (bytes). */
export const VS_SPREADSHEET_MAX_BYTES = 1_000_000;

export type VsSpreadsheetRow = {
  rank: number | null;
  name: string;
  score: number;
};

export type VsSpreadsheetParseWarning =
  | "skipped_invalid_score"
  | "skipped_blank"
  | "skipped_header_like"
  | "truncated_to_max_rows"
  | "no_header_used_positional";

export type VsSpreadsheetParseResult = {
  rows: VsSpreadsheetRow[];
  detectedPeriod: VsPeriod;
  detectedRecordedDate: string;
  warnings: VsSpreadsheetParseWarning[];
  headerRowIndex: number | null;
};

const NAME_ALIASES = new Set([
  "name",
  "commander",
  "player",
  "member",
  "commander name",
  "player name",
]);
const SCORE_ALIASES = new Set([
  "points",
  "score",
  "total",
  "vs",
  "vs points",
  "weekly points",
  "weekly score",
]);
const RANK_ALIASES = new Set(["rank", "#", "ranking", "pos", "position"]);

const ISO_DATE_RE = /\b(\d{4}-\d{2}-\d{2})\b/;
const WEEK_OF_RE = /week\s+of\s+(\d{4}-\d{2}-\d{2})/i;

function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : String(value);
  }
  return String(value).normalize("NFC").trim();
}

function normalizeHeader(value: string): string {
  return value
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/[_/|]+/g, " ")
    .replace(/\s+/g, " ");
}

function findHeaderRow(cells: string[][]): {
  index: number;
  rankCol: number | null;
  nameCol: number;
  scoreCol: number;
} | null {
  for (let i = 0; i < Math.min(cells.length, 20); i++) {
    const row = cells[i] ?? [];
    let rankCol: number | null = null;
    let nameCol: number | null = null;
    let scoreCol: number | null = null;
    for (let c = 0; c < row.length; c++) {
      const header = normalizeHeader(row[c] ?? "");
      if (!header) continue;
      if (RANK_ALIASES.has(header) && rankCol == null) rankCol = c;
      else if (NAME_ALIASES.has(header) && nameCol == null) nameCol = c;
      else if (SCORE_ALIASES.has(header) && scoreCol == null) scoreCol = c;
    }
    if (nameCol != null && scoreCol != null) {
      return { index: i, rankCol, nameCol, scoreCol };
    }
  }
  return null;
}

function parseOptionalRank(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[,.\s]/g, "");
  if (!/^\d+$/.test(cleaned)) return null;
  const rank = Number(cleaned);
  if (!Number.isSafeInteger(rank) || rank < 1) return null;
  return rank;
}

function looksLikeTotalRow(name: string, rank: number | null): boolean {
  const lower = name.toLowerCase();
  if (lower === "total" || lower === "totals" || lower === "sum") return true;
  if (rank == null && /^(alliance\s+)?total\b/.test(lower)) return true;
  return false;
}

function extractDatesFromText(text: string): string[] {
  const dates: string[] = [];
  const weekMatch = WEEK_OF_RE.exec(text);
  if (weekMatch?.[1]) dates.push(weekMatch[1]);
  for (const match of text.matchAll(new RegExp(ISO_DATE_RE.source, "g"))) {
    if (match[1] && !dates.includes(match[1])) dates.push(match[1]);
  }
  return dates;
}

/**
 * Resolve weekly/daily recorded date from spreadsheet title cells and optional
 * filename. Prefer "Week of YYYY-MM-DD" (Monday → Sunday week-ending). A
 * Saturday in the filename becomes the following Sunday for weekly reports.
 */
export function detectVsSpreadsheetPeriodAndDate(input: {
  cells: string[][];
  fileName?: string | null;
  now?: Date;
}): { period: VsPeriod; recordedDate: string } {
  const now = input.now ?? new Date();
  const titleBlob = (input.cells.slice(0, 5) ?? [])
    .flat()
    .map(cellText)
    .filter(Boolean)
    .join("\n");
  const fileName = input.fileName?.normalize("NFC") ?? "";
  const titleDates = extractDatesFromText(titleBlob);
  const fileDates = extractDatesFromText(fileName);
  const hasWeekOf = WEEK_OF_RE.test(titleBlob) || WEEK_OF_RE.test(fileName);

  if (hasWeekOf) {
    const weekOf =
      extractDatesFromText(
        WEEK_OF_RE.exec(titleBlob)?.[0] ??
          WEEK_OF_RE.exec(fileName)?.[0] ??
          "",
      )[0] ?? titleDates[0];
    if (weekOf) {
      const sunday = vsWeekEndingDate(weekOf);
      if (validateVsPeriod(sunday, "weekly")) {
        return { period: "weekly", recordedDate: sunday };
      }
    }
  }

  // Filename "Weekly Total - 2026-10-03.xlsx" — Saturday before Sunday totals.
  for (const date of [...fileDates, ...titleDates]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const dow = getServerDayOfWeek(date);
    if (dow === 0 && validateVsPeriod(date, "weekly")) {
      return { period: "weekly", recordedDate: date };
    }
    if (dow === 6) {
      const sunday = vsWeekEndingDate(date);
      if (validateVsPeriod(sunday, "weekly")) {
        return { period: "weekly", recordedDate: sunday };
      }
    }
  }

  // Daily dates may appear only in the filename (e.g. VS Daily - 2026-10-01.csv).
  for (const date of [...titleDates, ...fileDates]) {
    if (isValidVsPerformanceRecordedDate(date, "daily")) {
      return { period: "daily", recordedDate: date };
    }
  }

  return {
    period: "weekly",
    recordedDate: defaultVsPerformanceRecordedDate("weekly", now),
  };
}

/**
 * Parse a rectangular cell grid (CSV or first worksheet) into VS score rows.
 */
export function parseVsSpreadsheetTable(
  cells: string[][],
  options?: { fileName?: string | null; now?: Date },
): VsSpreadsheetParseResult {
  const warnings: VsSpreadsheetParseWarning[] = [];
  const { period, recordedDate } = detectVsSpreadsheetPeriodAndDate({
    cells,
    fileName: options?.fileName,
    now: options?.now,
  });

  const header = findHeaderRow(cells);
  let dataStart: number;
  let rankCol: number | null;
  let nameCol: number;
  let scoreCol: number;

  if (header) {
    dataStart = header.index + 1;
    rankCol = header.rankCol;
    nameCol = header.nameCol;
    scoreCol = header.scoreCol;
  } else {
    warnings.push("no_header_used_positional");
    dataStart = 0;
    // Skip leading metadata rows that are not rank/name/score shaped.
    while (dataStart < cells.length) {
      const row = cells[dataStart] ?? [];
      const a = cellText(row[0]);
      const b = cellText(row[1]);
      const c = cellText(row[2]);
      const rankOk = parseOptionalRank(a) != null;
      let scoreOk = false;
      try {
        parseVsScore(c || b);
        scoreOk = true;
      } catch {
        scoreOk = false;
      }
      if (rankOk && b && scoreOk) break;
      if (!a && !b && !c) {
        dataStart++;
        continue;
      }
      // Headerless: name in col0, score in col1.
      if (!rankOk && a && scoreOk && !c) break;
      dataStart++;
    }
    const probe = cells[dataStart] ?? [];
    const probeRank = parseOptionalRank(cellText(probe[0]));
    if (probeRank != null && cellText(probe[1]) && cellText(probe[2])) {
      rankCol = 0;
      nameCol = 1;
      scoreCol = 2;
    } else {
      rankCol = null;
      nameCol = 0;
      scoreCol = 1;
    }
  }

  const rows: VsSpreadsheetRow[] = [];
  for (let i = dataStart; i < cells.length; i++) {
    if (rows.length >= VS_SPREADSHEET_MAX_ROWS) {
      warnings.push("truncated_to_max_rows");
      break;
    }
    const row = cells[i] ?? [];
    const name = cellText(row[nameCol]);
    const scoreRaw = cellText(row[scoreCol]);
    const rankRaw = rankCol != null ? cellText(row[rankCol]) : "";
    if (!name && !scoreRaw && !rankRaw) {
      warnings.push("skipped_blank");
      continue;
    }
    if (!name || !scoreRaw) {
      warnings.push("skipped_blank");
      continue;
    }
    const rank = parseOptionalRank(rankRaw);
    if (looksLikeTotalRow(name, rank)) {
      warnings.push("skipped_header_like");
      continue;
    }
    // Skip accidental re-reads of the header.
    if (
      NAME_ALIASES.has(normalizeHeader(name)) ||
      SCORE_ALIASES.has(normalizeHeader(scoreRaw))
    ) {
      warnings.push("skipped_header_like");
      continue;
    }
    let score: number;
    try {
      score = parseVsScore(scoreRaw);
    } catch {
      warnings.push("skipped_invalid_score");
      continue;
    }
    rows.push({ rank, name, score });
  }

  return {
    rows,
    detectedPeriod: period,
    detectedRecordedDate: recordedDate,
    warnings: [...new Set(warnings)],
    headerRowIndex: header?.index ?? null,
  };
}

export function cellGridFromCsvMatrix(matrix: unknown[][]): string[][] {
  return matrix.map((row) =>
    (Array.isArray(row) ? row : []).map((cell) => cellText(cell)),
  );
}
