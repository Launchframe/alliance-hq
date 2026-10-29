export type RosterMemberNameRow = {
  memberId?: string | null;
  memberName?: string | null;
  deleted?: boolean;
};

export type ScoreSaveRosterRow = {
  id: string;
  name: string;
  status?: string | null;
};

/**
 * Ids allowed on a score save for this alliance.
 * Former members stay on the roster. Ashed can mark someone former while they
 * still appear on an in-game leaderboard, and a score save should keep that
 * match. Ids that are not on this alliance's roster stay rejected.
 */
export function rosterNamesForScoreSave(
  roster: readonly ScoreSaveRosterRow[],
): Map<string, string> {
  const names = new Map<string, string>();
  for (const row of roster) {
    const id = row.id.trim();
    if (!id) continue;
    names.set(id, row.name);
  }
  return names;
}

/** Local roster ids, plus any live Ashed ids when that list was fetched. */
export function memberIdsAllowedForScoreSave(input: {
  local: readonly ScoreSaveRosterRow[];
  liveIds?: readonly string[] | null;
}): Set<string> {
  const ids = new Set(rosterNamesForScoreSave(input.local).keys());
  for (const id of input.liveIds ?? []) {
    const trimmed = id.trim();
    if (trimmed) ids.add(trimmed);
  }
  return ids;
}

/** Display names for active rows whose member id is missing from the roster set. */
export function rosterMismatchMemberNames(
  rows: readonly RosterMemberNameRow[],
  activeMemberIds: ReadonlySet<string>,
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.deleted) continue;
    const memberId = row.memberId?.trim();
    if (!memberId || activeMemberIds.has(memberId)) continue;
    const name = row.memberName?.trim() ?? "";
    if (!name) continue;
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}
