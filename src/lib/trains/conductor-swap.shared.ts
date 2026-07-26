import { addCalendarDays } from "@/lib/trains/game-time";

export type ConductorSwapRecord = {
  date: string;
  conductorMemberId: string | null;
  conductorMemberName: string | null;
  lockedAt?: string | null;
};

export type ConductorSwapCandidate = {
  date: string;
  conductorMemberId: string | null;
  conductorMemberName: string | null;
  lockedAt: string | null;
};

/** Default number of upcoming-day quick picks in the swap dialog. */
export const CONDUCTOR_SWAP_QUICK_PICK_COUNT = 3;

/** How far ahead to scan when skipping locked / source days. */
const CONDUCTOR_SWAP_SCAN_HORIZON_DAYS = 60;

export function canStartConductorSwap(
  record: ConductorSwapRecord | null | undefined,
): boolean {
  return Boolean(
    record?.conductorMemberId &&
      record.conductorMemberName &&
      record.lockedAt == null,
  );
}

/** Earliest valid swap target (day after server today). */
export function earliestConductorSwapTargetDate(today: string): string {
  return addCalendarDays(today, 1);
}

export function isValidConductorSwapTargetDate(input: {
  targetDate: string;
  sourceDate: string;
  today: string;
}): boolean {
  return (
    input.targetDate > input.today && input.targetDate !== input.sourceDate
  );
}

export function resolveConductorSwapCandidate(
  date: string,
  weekRecords: ConductorSwapRecord[],
): ConductorSwapCandidate {
  const record = weekRecords.find((row) => row.date === date);
  return {
    date,
    conductorMemberId: record?.conductorMemberId ?? null,
    conductorMemberName: record?.conductorMemberName ?? null,
    lockedAt: record?.lockedAt ?? null,
  };
}

/**
 * Upcoming unlocked days for swap quick picks — not limited to the current
 * train week. Skips today/past, the source day, and known locked targets.
 */
export function conductorSwapCandidates(input: {
  sourceDate: string;
  /** Server calendar today (YYYY-MM-DD) — targets must be strictly after this. */
  today: string;
  weekRecords: ConductorSwapRecord[];
  /** Max quick picks (default 3). */
  limit?: number;
}): ConductorSwapCandidate[] {
  const limit = input.limit ?? CONDUCTOR_SWAP_QUICK_PICK_COUNT;
  const lockedDates = new Set(
    input.weekRecords
      .filter((row) => row.lockedAt != null)
      .map((row) => row.date),
  );

  const candidates: ConductorSwapCandidate[] = [];
  for (let offset = 1; offset <= CONDUCTOR_SWAP_SCAN_HORIZON_DAYS; offset += 1) {
    if (candidates.length >= limit) break;
    const date = addCalendarDays(input.today, offset);
    if (date === input.sourceDate) continue;
    if (lockedDates.has(date)) continue;
    candidates.push(resolveConductorSwapCandidate(date, input.weekRecords));
  }
  return candidates;
}
