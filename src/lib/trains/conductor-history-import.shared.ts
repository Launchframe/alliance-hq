import { addCalendarDays } from "@/lib/trains/game-time";

const MONTH_NAME_TO_NUMBER: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const DATE_ANCHOR_RE =
  /\(\s*([A-Za-z]+)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?\s*\)\s*$/;

const HEADER_RE = /^alliance\s+trains\s*$/i;

export type ParsedHistoryLine = {
  raw: string;
  name: string;
  anchorMonth?: number;
  anchorDay?: number;
  anchorYear?: number;
};

export type HistoryImportDateFlag =
  | "gap"
  | "date_conflict"
  | "missing_date"
  | "not_past"
  | "not_descending";

export type InterpolatedHistoryRow = {
  index: number;
  name: string;
  date: string | null;
  flags: HistoryImportDateFlag[];
};

export type ExistingConductorSnapshot = {
  date: string;
  conductorMemberId: string | null;
  conductorMemberName: string | null;
  lockedAt: string | null;
};

export type HistoryImportRowCommitStatus =
  | "ready"
  | "already_locked"
  | "conflict_locked"
  | "unmatched"
  | "overwrite_draft"
  | "not_past"
  | "gap"
  | "date_conflict"
  | "missing_date"
  | "not_descending";

/** Absolute calendar-day difference (later − earlier). */
export function calendarDayDiff(later: string, earlier: string): number {
  const a = new Date(`${later}T12:00:00.000-02:00`);
  const b = new Date(`${earlier}T12:00:00.000-02:00`);
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

export function padMonthDay(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseHistoryPaste(text: string): ParsedHistoryLine[] {
  const lines: ParsedHistoryLine[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const raw = rawLine.trim();
    if (!raw) continue;
    if (HEADER_RE.test(raw)) continue;

    const anchorMatch = raw.match(DATE_ANCHOR_RE);
    let name = raw;
    let anchorMonth: number | undefined;
    let anchorDay: number | undefined;
    let anchorYear: number | undefined;

    if (anchorMatch) {
      const monthToken = anchorMatch[1]?.toLowerCase() ?? "";
      const month = MONTH_NAME_TO_NUMBER[monthToken];
      const day = Number.parseInt(anchorMatch[2] ?? "", 10);
      const yearRaw = anchorMatch[3];
      if (month && day >= 1 && day <= 31) {
        name = raw.slice(0, anchorMatch.index).trim();
        anchorMonth = month;
        anchorDay = day;
        if (yearRaw) {
          const year = Number.parseInt(yearRaw, 10);
          if (year >= 2000 && year <= 2100) anchorYear = year;
        }
      }
    }

    if (!name) continue;
    lines.push({
      raw,
      name,
      ...(anchorMonth != null ? { anchorMonth } : {}),
      ...(anchorDay != null ? { anchorDay } : {}),
      ...(anchorYear != null ? { anchorYear } : {}),
    });
  }
  return lines;
}

function resolveLineAnchorDate(
  line: ParsedHistoryLine,
  defaultYear: number,
): string | null {
  if (line.anchorMonth == null || line.anchorDay == null) return null;
  const year = line.anchorYear ?? defaultYear;
  return padMonthDay(year, line.anchorMonth, line.anchorDay);
}

/**
 * Interpolate descending calendar dates for a newest→oldest paste list.
 * Optional firstDate/lastDate override the first/last rows.
 */
export function interpolateHistoryDates(input: {
  lines: ParsedHistoryLine[];
  today: string;
  defaultYear: number;
  firstDate?: string | null;
  lastDate?: string | null;
}): {
  rows: InterpolatedHistoryRow[];
  hasGap: boolean;
} {
  const n = input.lines.length;
  const dates: Array<string | null> = Array.from({ length: n }, () => null);
  const flags: HistoryImportDateFlag[][] = Array.from({ length: n }, () => []);

  if (n === 0) {
    return { rows: [], hasGap: false };
  }

  for (let i = 0; i < n; i += 1) {
    dates[i] = resolveLineAnchorDate(input.lines[i]!, input.defaultYear);
  }

  if (input.firstDate) {
    dates[0] = input.firstDate;
  }
  if (input.lastDate) {
    dates[n - 1] = input.lastDate;
  }

  const anchorIndexes: number[] = [];
  for (let i = 0; i < n; i += 1) {
    if (dates[i]) anchorIndexes.push(i);
  }

  let hasGap = false;

  if (anchorIndexes.length < 2) {
    for (let i = 0; i < n; i += 1) {
      if (!dates[i]) flags[i]!.push("missing_date");
    }
  } else {
    for (let a = 0; a < anchorIndexes.length - 1; a += 1) {
      const i = anchorIndexes[a]!;
      const j = anchorIndexes[a + 1]!;
      const start = dates[i]!;
      const end = dates[j]!;

      if (start <= end) {
        hasGap = true;
        for (let k = i; k <= j; k += 1) {
          if (!flags[k]!.includes("not_descending")) {
            flags[k]!.push("not_descending");
          }
        }
        continue;
      }

      const expectedSteps = calendarDayDiff(start, end);
      if (expectedSteps !== j - i) {
        hasGap = true;
        for (let k = i; k <= j; k += 1) {
          if (!flags[k]!.includes("gap")) flags[k]!.push("gap");
        }
        continue;
      }

      for (let k = i; k <= j; k += 1) {
        const expected = addCalendarDays(start, -(k - i));
        const existing = dates[k];
        if (existing && existing !== expected) {
          if (!flags[k]!.includes("date_conflict")) {
            flags[k]!.push("date_conflict");
          }
        }
        dates[k] = expected;
      }
    }

    for (let i = 0; i < n; i += 1) {
      if (!dates[i] && !flags[i]!.includes("gap")) {
        flags[i]!.push("missing_date");
      }
    }
  }

  for (let i = 0; i < n; i += 1) {
    const date = dates[i];
    if (date && date >= input.today && !flags[i]!.includes("not_past")) {
      flags[i]!.push("not_past");
    }
  }

  const rows: InterpolatedHistoryRow[] = input.lines.map((line, index) => ({
    index,
    name: line.name,
    date: dates[index] ?? null,
    flags: flags[index] ?? [],
  }));

  return { rows, hasGap };
}

export function classifyHistoryImportRow(input: {
  date: string | null;
  flags: HistoryImportDateFlag[];
  memberId: string | null;
  existing: ExistingConductorSnapshot | null | undefined;
}): HistoryImportRowCommitStatus {
  if (input.flags.includes("gap")) return "gap";
  if (input.flags.includes("date_conflict")) return "date_conflict";
  if (input.flags.includes("not_descending")) return "not_descending";
  if (input.flags.includes("missing_date") || !input.date) return "missing_date";
  if (input.flags.includes("not_past")) return "not_past";
  if (!input.memberId) return "unmatched";

  const existing = input.existing;
  if (existing?.lockedAt) {
    if (existing.conductorMemberId === input.memberId) return "already_locked";
    return "conflict_locked";
  }
  if (existing?.conductorMemberId) return "overwrite_draft";
  return "ready";
}

export function historyImportRowIsCommitable(
  status: HistoryImportRowCommitStatus,
): boolean {
  return status === "ready" || status === "overwrite_draft";
}
