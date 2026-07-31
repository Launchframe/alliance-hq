import type {
  DepositSlipTimePendingDate,
  ParsedDepositSlipDraft,
} from "@/lib/banks/deposit-slip-ocr/parse-deposit-slip-text.shared";

/** UTC wall-clock season year for deposits missing a year (game season ~few months). */
export function resolveDepositSlipSeasonYear(
  slips: readonly { depositAt: string | null }[],
  now: Date,
): number | null {
  const month = now.getUTCMonth();
  const day = now.getUTCDate();
  const onOrAfterMarch1 = month > 2 || (month === 2 && day >= 1);
  if (onOrAfterMarch1) {
    return now.getUTCFullYear();
  }

  const years = new Set<number>();
  for (const slip of slips) {
    if (!slip.depositAt) continue;
    const y = new Date(slip.depositAt).getUTCFullYear();
    if (Number.isFinite(y)) years.add(y);
  }
  if (years.size === 1) {
    return [...years][0]!;
  }
  return null;
}

/** Round UTC deposit timestamps to the nearest 10 minutes (game OCR is often fuzzy). */
export function roundDepositSlipUtcToNearestTenMinutes(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const date = new Date(ms);
  const totalMinutes =
    date.getUTCHours() * 60 +
    date.getUTCMinutes() +
    date.getUTCSeconds() / 60;
  const roundedMinutes = Math.round(totalMinutes / 10) * 10;
  const dayOffset = Math.floor(roundedMinutes / (24 * 60));
  const minutesInDay = ((roundedMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(minutesInDay / 60);
  const minutes = minutesInDay % 60;

  const out = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() + dayOffset,
      hours,
      minutes,
      0,
      0,
    ),
  );
  return out.toISOString();
}

/** Round to the top of the UTC hour when only the hour was recovered from OCR. */
export function roundDepositSlipUtcToHour(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const date = new Date(ms);
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours(),
      0,
      0,
      0,
    ),
  ).toISOString();
}

export function buildDepositSlipUtcIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
  round: "ten_minutes" | "hour" | "none" = "ten_minutes",
): string | null {
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}.000Z`;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const normalized = new Date(ms).toISOString();
  if (round === "hour") return roundDepositSlipUtcToHour(normalized);
  if (round === "ten_minutes") {
    return roundDepositSlipUtcToNearestTenMinutes(normalized);
  }
  return normalized;
}

type FrameAnchor = {
  frameIndex: number;
  depositAtMs: number;
};

type UtcCalendarDate = {
  year: number;
  month: number;
  day: number;
};

function utcCalendarDateFromMs(ms: number): UtcCalendarDate {
  const date = new Date(ms);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function borrowDepositDateFromFrameNeighbors(
  frameIndex: number,
  anchors: readonly FrameAnchor[],
): UtcCalendarDate | null {
  if (anchors.length === 0) return null;

  let prev: FrameAnchor | null = null;
  let next: FrameAnchor | null = null;
  for (const anchor of anchors) {
    if (anchor.frameIndex <= frameIndex) {
      if (!prev || anchor.frameIndex > prev.frameIndex) prev = anchor;
    }
    if (anchor.frameIndex >= frameIndex) {
      if (!next || anchor.frameIndex < next.frameIndex) next = anchor;
    }
  }

  if (prev && next) {
    const distPrev = frameIndex - prev.frameIndex;
    const distNext = next.frameIndex - frameIndex;
    const chosen = distPrev <= distNext ? prev : next;
    return utcCalendarDateFromMs(chosen.depositAtMs);
  }

  const chosen = prev ?? next;
  return chosen ? utcCalendarDateFromMs(chosen.depositAtMs) : null;
}

function buildDepositAtFromPendingDate(
  date: UtcCalendarDate,
  pending: DepositSlipTimePendingDate,
): string | null {
  return buildDepositSlipUtcIso(
    date.year,
    date.month,
    date.day,
    pending.hour,
    pending.minute,
    pending.second,
    pending.round,
  );
}

/**
 * When OCR read a plausible time but month/day were invalid, borrow
 * YYYY-MM-DD from the nearest frame with a known-good timestamp.
 */
export function repairInvalidDepositSlipDates(
  slips: ParsedDepositSlipDraft[],
): void {
  if (slips.length === 0) return;

  const anchors: FrameAnchor[] = [];
  for (const slip of slips) {
    if (slip.depositAt == null || slip.sourceFrameIndex == null) continue;
    const ms = Date.parse(slip.depositAt);
    if (Number.isNaN(ms)) continue;
    anchors.push({ frameIndex: slip.sourceFrameIndex, depositAtMs: ms });
  }
  anchors.sort((a, b) => a.frameIndex - b.frameIndex);

  for (const slip of slips) {
    if (!slip.depositAtTimePendingDate || slip.sourceFrameIndex == null) {
      continue;
    }
    const borrowed = borrowDepositDateFromFrameNeighbors(
      slip.sourceFrameIndex,
      anchors,
    );
    if (!borrowed) continue;
    const repaired = buildDepositAtFromPendingDate(
      borrowed,
      slip.depositAtTimePendingDate,
    );
    if (!repaired) continue;
    slip.depositAt = repaired;
    slip.depositAtTimePendingDate = undefined;
  }
}

function inferDepositAtFromFrameNeighbors(
  frameIndex: number,
  anchors: readonly FrameAnchor[],
): string | null {
  if (anchors.length === 0) return null;

  let prev: FrameAnchor | null = null;
  let next: FrameAnchor | null = null;
  for (const anchor of anchors) {
    if (anchor.frameIndex <= frameIndex) {
      if (!prev || anchor.frameIndex > prev.frameIndex) prev = anchor;
    }
    if (anchor.frameIndex >= frameIndex) {
      if (!next || anchor.frameIndex < next.frameIndex) next = anchor;
    }
  }

  if (prev && next && prev.frameIndex !== next.frameIndex) {
    const ratio =
      (frameIndex - prev.frameIndex) / (next.frameIndex - prev.frameIndex);
    const ms = prev.depositAtMs + ratio * (next.depositAtMs - prev.depositAtMs);
    return roundDepositSlipUtcToNearestTenMinutes(new Date(ms).toISOString());
  }

  if (prev && prev.frameIndex === frameIndex) {
    return roundDepositSlipUtcToNearestTenMinutes(
      new Date(prev.depositAtMs).toISOString(),
    );
  }
  if (next && next.frameIndex === frameIndex) {
    return roundDepositSlipUtcToNearestTenMinutes(
      new Date(next.depositAtMs).toISOString(),
    );
  }

  return null;
}

/**
 * Best-effort fill for slips whose timestamp line was dropped or mangled by OCR.
 * Mutates slips in place. Runs before fuzzy dedupe so minute-level guesses can fold rows.
 */
export function inferMissingDepositSlipTimestamps(
  slips: ParsedDepositSlipDraft[],
): void {
  if (slips.length === 0) return;

  const anchors: FrameAnchor[] = [];
  for (const slip of slips) {
    if (slip.depositAt == null || slip.sourceFrameIndex == null) continue;
    const ms = Date.parse(slip.depositAt);
    if (Number.isNaN(ms)) continue;
    anchors.push({ frameIndex: slip.sourceFrameIndex, depositAtMs: ms });
  }
  anchors.sort((a, b) => a.frameIndex - b.frameIndex);

  for (const slip of slips) {
    if (
      slip.depositAt != null ||
      slip.depositAtTimePendingDate != null ||
      slip.sourceFrameIndex == null
    ) {
      continue;
    }
    const inferred = inferDepositAtFromFrameNeighbors(
      slip.sourceFrameIndex,
      anchors,
    );
    if (inferred) {
      slip.depositAt = inferred;
    }
  }
}
