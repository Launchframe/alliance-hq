export type RosterMemberNameRow = {
  memberId?: string | null;
  memberName?: string | null;
  deleted?: boolean;
};

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
