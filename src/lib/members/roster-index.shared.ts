import type { CommanderIndexRow } from "@/lib/commanders/index.shared";
import { commanderIndexRowMatchesHqLinkFilter } from "@/lib/commanders/index.shared";
import type { CommanderIndexHqLinkFilter } from "@/lib/commanders/index.shared";
import type { MainSquadType } from "@/lib/commanders/main-squad.shared";
import type { AshedMember } from "@/lib/video/member-matcher";
import { memberTotalHeroPower } from "@/lib/vr/leaderboard";

export type RosterColumnId =
  | "name"
  | "previousNames"
  | "allianceRank"
  | "rankTitle"
  | "status"
  | "thp"
  | "mainSquad"
  | "inGameRank"
  | "vr"
  | "hqLinked"
  | "squadEdit";

export const ROSTER_COLUMN_IDS: readonly RosterColumnId[] = [
  "name",
  "previousNames",
  "allianceRank",
  "rankTitle",
  "status",
  "thp",
  "mainSquad",
  "inGameRank",
  "vr",
  "hqLinked",
  "squadEdit",
];

export type RosterMergedRow = {
  ashedMemberId: string;
  member: AshedMember;
  commander: CommanderIndexRow | null;
};

export type RosterCommanderFilters = {
  filterSquad: MainSquadType | "";
  filterHqLink: CommanderIndexHqLinkFilter;
  filterMinThp: number;
  includeUnreported: boolean;
};

export type RosterColumnVisibilityOptions = {
  canWrite: boolean;
  showSquadEdit: boolean;
};

export function rosterColumnAlwaysVisible(columnId: RosterColumnId): boolean {
  return columnId === "name";
}

export function defaultRosterColumnVisibility(
  options: RosterColumnVisibilityOptions,
): Record<RosterColumnId, boolean> {
  return {
    name: true,
    previousNames: options.canWrite,
    allianceRank: true,
    rankTitle: false,
    status: true,
    thp: true,
    mainSquad: true,
    inGameRank: false,
    vr: true,
    hqLinked: true,
    squadEdit: options.showSquadEdit,
  };
}

export function buildCommanderRowMap(
  rows: CommanderIndexRow[],
): Map<string, CommanderIndexRow> {
  return new Map(rows.map((row) => [row.ashedMemberId, row]));
}

export function mergeMembersWithCommanderIndex(
  members: AshedMember[],
  commanderRows: CommanderIndexRow[],
): RosterMergedRow[] {
  const commanderById = buildCommanderRowMap(commanderRows);
  return members.map((member) => ({
    ashedMemberId: member.id,
    member,
    commander: commanderById.get(member.id) ?? null,
  }));
}

export function rosterRowTotalHeroPower(row: RosterMergedRow): number {
  if (row.commander) {
    return row.commander.totalHeroPower;
  }
  return memberTotalHeroPower(row.member);
}

export function rosterRowMainSquad(
  row: RosterMergedRow,
): MainSquadType | null {
  return row.commander?.mainSquad ?? null;
}

export function rosterRowHqLinked(row: RosterMergedRow): boolean {
  return row.commander?.hqLinked ?? false;
}

export function rosterRowMatchesCommanderFilters(
  row: RosterMergedRow,
  filters: RosterCommanderFilters,
): boolean {
  if (filters.filterSquad && rosterRowMainSquad(row) !== filters.filterSquad) {
    return false;
  }

  if (
    !commanderIndexRowMatchesHqLinkFilter(
      { hqLinked: rosterRowHqLinked(row) },
      filters.filterHqLink,
    )
  ) {
    return false;
  }

  if (!filters.includeUnreported && rosterRowMainSquad(row) == null) {
    return false;
  }

  if (
    filters.filterMinThp > 0 &&
    rosterRowTotalHeroPower(row) < filters.filterMinThp
  ) {
    return false;
  }

  return true;
}

export type RosterSortKey =
  | "name"
  | "thp"
  | "squad"
  | "vr"
  | "allianceRank"
  | "status";

export type RosterSortDir = "asc" | "desc";

export function sortRosterRows(
  rows: RosterMergedRow[],
  sortKey: RosterSortKey,
  sortDir: RosterSortDir,
): RosterMergedRow[] {
  const squadOrder: Record<string, number> = {
    aircraft: 0,
    tank: 1,
    missile: 2,
  };

  const sorted = [...rows].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case "name":
        cmp = a.member.current_name.localeCompare(
          b.member.current_name,
          undefined,
          { sensitivity: "base" },
        );
        break;
      case "thp":
        cmp = rosterRowTotalHeroPower(a) - rosterRowTotalHeroPower(b);
        break;
      case "squad":
        cmp =
          (squadOrder[rosterRowMainSquad(a) ?? ""] ?? 3) -
          (squadOrder[rosterRowMainSquad(b) ?? ""] ?? 3);
        break;
      case "vr":
        cmp =
          (a.commander?.highestBaseVr ?? -1) -
          (b.commander?.highestBaseVr ?? -1);
        break;
      case "allianceRank":
        cmp =
          (a.commander?.allianceRank ??
            Number.POSITIVE_INFINITY) -
          (b.commander?.allianceRank ?? Number.POSITIVE_INFINITY);
        break;
      case "status":
        cmp = (a.member.status ?? "active").localeCompare(
          b.member.status ?? "active",
        );
        break;
      default: {
        const _exhaustive: never = sortKey;
        return _exhaustive;
      }
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  return sorted;
}

export function visibleRosterColumns(
  visibility: Record<RosterColumnId, boolean>,
): RosterColumnId[] {
  return ROSTER_COLUMN_IDS.filter((columnId) => visibility[columnId]);
}
