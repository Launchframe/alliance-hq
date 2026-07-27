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
  /** Intentional empty placeholder for an unknown/missing conductor day. */
  blank?: boolean;
  anchorMonth?: number;
  anchorDay?: number;
  anchorYear?: number;
};

export type HistoryImportDateFlag =
  | "gap"
  | "date_conflict"
  | "missing_date"
  | "not_past"
  | "not_descending"
  | "blank";

export type InterpolatedHistoryRow = {
  index: number;
  name: string;
  date: string | null;
  flags: HistoryImportDateFlag[];
  blank?: boolean;
  /** Set when an explicit date label is older than sequential list order. */
  anchorConflict?: {
    labeledDate: string;
    expectedDate: string;
    /** How many blank rows to insert before this row to clear the gap. */
    missingDayCount: number;
  };
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
  | "not_descending"
  | "blank";

/** Absolute calendar-day difference (later − earlier). */
export function calendarDayDiff(later: string, earlier: string): number {
  const a = new Date(`${later}T12:00:00.000-02:00`);
  const b = new Date(`${earlier}T12:00:00.000-02:00`);
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

export function padMonthDay(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function createBlankHistoryLine(): ParsedHistoryLine {
  return { raw: "", name: "", blank: true };
}

/** Insert `count` blank placeholder lines before `index`. */
export function insertBlankLinesBefore(
  lines: ParsedHistoryLine[],
  index: number,
  count: number,
): ParsedHistoryLine[] {
  if (count <= 0) return lines;
  const blanks = Array.from({ length: count }, () => createBlankHistoryLine());
  return [...lines.slice(0, index), ...blanks, ...lines.slice(index)];
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
  if (line.blank) return null;
  if (line.anchorMonth == null || line.anchorDay == null) return null;
  const year = line.anchorYear ?? defaultYear;
  return padMonthDay(year, line.anchorMonth, line.anchorDay);
}

/**
 * Interpolate descending calendar dates for a newest→oldest paste list.
 *
 * Newest date alone is enough for a clean list. When a later labeled date is
 * older than the sequential expectation, that row is flagged and the timeline
 * re-bases onto the labeled date so later anchors can be checked independently.
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
  const conflicts = new Map<
    number,
    {
      labeledDate: string;
      expectedDate: string;
      missingDayCount: number;
    }
  >();

  if (n === 0) {
    return { rows: [], hasGap: false };
  }

  for (let i = 0; i < n; i += 1) {
    if (input.lines[i]?.blank) {
      flags[i]!.push("blank");
    }
    dates[i] = resolveLineAnchorDate(input.lines[i]!, input.defaultYear);
  }

  if (input.firstDate) {
    dates[0] = input.firstDate;
  }
  if (input.lastDate) {
    dates[n - 1] = input.lastDate;
  }

  const explicitAnchors: Array<{ index: number; date: string }> = [];
  for (let i = 0; i < n; i += 1) {
    if (dates[i]) explicitAnchors.push({ index: i, date: dates[i]! });
  }

  let hasGap = false;

  if (explicitAnchors.length === 0) {
    for (let i = 0; i < n; i += 1) {
      if (!flags[i]!.includes("blank")) flags[i]!.push("missing_date");
    }
  } else {
    let cursorIndex = explicitAnchors[0]!.index;
    let cursorDate = explicitAnchors[0]!.date;

    for (let k = 0; k <= cursorIndex; k += 1) {
      dates[k] = addCalendarDays(cursorDate, cursorIndex - k);
    }

    for (let a = 1; a < explicitAnchors.length; a += 1) {
      const anchor = explicitAnchors[a]!;
      const expected = addCalendarDays(
        cursorDate,
        -(anchor.index - cursorIndex),
      );

      for (let k = cursorIndex + 1; k <= anchor.index; k += 1) {
        dates[k] = addCalendarDays(cursorDate, -(k - cursorIndex));
      }

      if (anchor.date === expected) {
        cursorIndex = anchor.index;
        cursorDate = anchor.date;
        continue;
      }

      if (anchor.date < expected) {
        const missingDayCount = calendarDayDiff(expected, anchor.date);
        hasGap = true;
        if (!flags[anchor.index]!.includes("date_conflict")) {
          flags[anchor.index]!.push("date_conflict");
        }
        conflicts.set(anchor.index, {
          labeledDate: anchor.date,
          expectedDate: expected,
          missingDayCount,
        });
        // Re-base onto the labeled date and keep evaluating later anchors.
        dates[anchor.index] = anchor.date;
        cursorIndex = anchor.index;
        cursorDate = anchor.date;
        continue;
      }

      // Labeled date is newer than the sequence allows.
      hasGap = true;
      if (!flags[anchor.index]!.includes("not_descending")) {
        flags[anchor.index]!.push("not_descending");
      }
      dates[anchor.index] = anchor.date;
      cursorIndex = anchor.index;
      cursorDate = anchor.date;
    }

    for (let k = cursorIndex + 1; k < n; k += 1) {
      dates[k] = addCalendarDays(cursorDate, -(k - cursorIndex));
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
    ...(line.blank ? { blank: true } : {}),
    ...(conflicts.has(index) ? { anchorConflict: conflicts.get(index) } : {}),
  }));

  return { rows, hasGap };
}

export function classifyHistoryImportRow(input: {
  date: string | null;
  flags: HistoryImportDateFlag[];
  memberId: string | null;
  blank?: boolean;
  existing: ExistingConductorSnapshot | null | undefined;
}): HistoryImportRowCommitStatus {
  if (input.blank || input.flags.includes("blank")) return "blank";
  if (input.flags.includes("date_conflict")) return "date_conflict";
  if (input.flags.includes("gap")) return "gap";
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
