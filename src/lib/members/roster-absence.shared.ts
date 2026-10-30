import { massFormerNeedsConfirm } from "@/lib/alliance/rename-in-place.shared";
import { NATIVE_ROSTER_ASHED_ALLIANCE_ID } from "@/lib/native-alliance/constants";

/**
 * A successful Ashed list must cover at least this fraction of the HQ rows
 * Ashed has already confirmed. A shorter list is treated as truncated and
 * does not mark anyone former.
 */
export const ROSTER_ABSENCE_MIN_LIST_FRACTION = 0.5;

export type RosterAbsenceCandidate = {
  ashedMemberId: string;
  status: string;
  /** Set when a previous Ashed payload confirmed this row. */
  ashedConfirmed: boolean;
  ashedAllianceId?: string | null;
};

function isSyntheticAshedAllianceId(
  ashedAllianceId: string | null | undefined,
): boolean {
  const id = ashedAllianceId?.trim() ?? "";
  return (
    !id ||
    id === NATIVE_ROSTER_ASHED_ALLIANCE_ID ||
    id.startsWith(`${NATIVE_ROSTER_ASHED_ALLIANCE_ID}:`)
  );
}

/**
 * HQ rows to mark former after a successful Ashed member list.
 * Pending HQ adds (never confirmed on Ashed) and native rows stay active.
 * An empty or truncated list marks nobody.
 */
export function rosterMemberIdsAbsentFromAshed(input: {
  local: readonly RosterAbsenceCandidate[];
  returnedAshedMemberIds: readonly string[];
  guardedMemberIds?: readonly string[];
}): string[] {
  const returned = new Set(
    input.returnedAshedMemberIds
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  );
  if (returned.size === 0) return [];

  const guarded = new Set(
    (input.guardedMemberIds ?? [])
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  );

  const confirmedCount = input.local.filter(
    (row) =>
      row.ashedConfirmed && !isSyntheticAshedAllianceId(row.ashedAllianceId),
  ).length;
  if (
    confirmedCount > 0 &&
    returned.size < confirmedCount * ROSTER_ABSENCE_MIN_LIST_FRACTION
  ) {
    return [];
  }

  const absent: string[] = [];
  const seen = new Set<string>();
  for (const row of input.local) {
    const id = row.ashedMemberId.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (row.status === "former") continue;
    if (!row.ashedConfirmed) continue;
    if (isSyntheticAshedAllianceId(row.ashedAllianceId)) continue;
    if (returned.has(id) || guarded.has(id)) continue;
    absent.push(id);
  }
  return absent;
}

/** Confirmed-active Ashed rows that can be marked former by the absence pass. */
export function countConfirmedActiveRosterRows(
  local: readonly RosterAbsenceCandidate[],
): number {
  let count = 0;
  for (const row of local) {
    if (row.status === "former") continue;
    if (!row.ashedConfirmed) continue;
    if (isSyntheticAshedAllianceId(row.ashedAllianceId)) continue;
    count += 1;
  }
  return count;
}

/**
 * Whether applying the absence pass would former enough of the roster that
 * an officer should confirm (post-rename catch-up). Truncation still returns
 * an empty absent list first.
 */
export function rosterAbsenceMassFormerPreview(input: {
  local: readonly RosterAbsenceCandidate[];
  returnedAshedMemberIds: readonly string[];
  guardedMemberIds?: readonly string[];
}): {
  absentIds: string[];
  confirmedActiveCount: number;
  needsConfirm: boolean;
} {
  const absentIds = rosterMemberIdsAbsentFromAshed(input);
  const confirmedActiveCount = countConfirmedActiveRosterRows(input.local);
  return {
    absentIds,
    confirmedActiveCount,
    needsConfirm: massFormerNeedsConfirm({
      wouldFormerCount: absentIds.length,
      confirmedActiveCount,
    }),
  };
}
