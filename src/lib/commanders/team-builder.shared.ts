import { assignSnakeDraft } from "@/lib/shared/snake-draft.shared";
import type { MainSquadSource, MainSquadType } from "@/lib/commanders/main-squad.shared";

export type CommanderTeamRow = {
  ashedMemberId: string;
  memberName: string;
  totalHeroPower: number;
  mainSquad: MainSquadType | null;
  mainSquadSource: MainSquadSource | null;
  allianceRank: number | null;
  highestBaseVr: number | null;
};

export type CommanderTeam = {
  teamIndex: number;
  lead: CommanderTeamRow;
  fillers: CommanderTeamRow[];
  teamTotalHeroPower: number;
};

export type CommanderTeamsResult =
  | { ok: true; teams: CommanderTeam[] }
  | { ok: false; error: "insufficient_players"; needed: number; have: number };

export type BuildCommanderTeamsOptions = {
  mainSquad?: MainSquadType | null;
  includeUnreported?: boolean;
};

function rowMatchesSquadFilter(
  row: CommanderTeamRow,
  options: BuildCommanderTeamsOptions,
): boolean {
  if (options.mainSquad) {
    return row.mainSquad === options.mainSquad;
  }
  if (options.includeUnreported === false && row.mainSquad == null) {
    return false;
  }
  return true;
}

function sortByThpDesc(a: CommanderTeamRow, b: CommanderTeamRow): number {
  if (b.totalHeroPower !== a.totalHeroPower) {
    return b.totalHeroPower - a.totalHeroPower;
  }
  const rankA = a.allianceRank ?? 0;
  const rankB = b.allianceRank ?? 0;
  return rankB - rankA;
}

export function buildCommanderTeams(
  rows: CommanderTeamRow[],
  teamCount: number,
  options: BuildCommanderTeamsOptions = {},
): CommanderTeamsResult {
  if (teamCount < 1) {
    return { ok: false, error: "insufficient_players", needed: 5, have: rows.length };
  }

  const pool = rows.filter((row) => rowMatchesSquadFilter(row, options)).sort(sortByThpDesc);

  const needed = teamCount * 5;
  if (pool.length < needed) {
    return { ok: false, error: "insufficient_players", needed, have: pool.length };
  }

  const leads = pool.slice(0, teamCount);
  const fillerPool = pool.slice(teamCount).sort(sortByThpDesc);
  const fillers = fillerPool.slice(0, teamCount * 4);
  const fillerGroups = assignSnakeDraft(fillers, teamCount, 4);

  const teams: CommanderTeam[] = leads.map((lead, index) => {
    const teamFillers = fillerGroups[index] ?? [];
    const teamTotalHeroPower =
      lead.totalHeroPower +
      teamFillers.reduce((sum, row) => sum + row.totalHeroPower, 0);
    return {
      teamIndex: index + 1,
      lead,
      fillers: teamFillers,
      teamTotalHeroPower,
    };
  });

  return { ok: true, teams };
}

export function summarizeByMainSquad(rows: CommanderTeamRow[]): {
  aircraft: { count: number; avgThp: number };
  tank: { count: number; avgThp: number };
  missile: { count: number; avgThp: number };
  unreported: { count: number; avgThp: number };
} {
  const buckets = {
    aircraft: [] as number[],
    tank: [] as number[],
    missile: [] as number[],
    unreported: [] as number[],
  };

  for (const row of rows) {
    const key =
      row.mainSquad === "aircraft" ||
      row.mainSquad === "tank" ||
      row.mainSquad === "missile"
        ? row.mainSquad
        : "unreported";
    buckets[key].push(row.totalHeroPower);
  }

  function avg(values: number[]): number {
    if (values.length === 0) return 0;
    return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  }

  return {
    aircraft: { count: buckets.aircraft.length, avgThp: avg(buckets.aircraft) },
    tank: { count: buckets.tank.length, avgThp: avg(buckets.tank) },
    missile: { count: buckets.missile.length, avgThp: avg(buckets.missile) },
    unreported: {
      count: buckets.unreported.length,
      avgThp: avg(buckets.unreported),
    },
  };
}
