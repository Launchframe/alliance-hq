import type { AshedMember } from "@/lib/video/member-matcher";

import { assignSnakeDraft } from "@/lib/shared/snake-draft.shared";

import type { MemberSeasonVr } from "@/lib/db/schema";
import { effectiveBaseVr } from "@/lib/vr/effective-vr.shared";
import { coerceInstituteLevelFromBaseVr } from "@/lib/vr/institute-levels.shared";

export type LeaderboardRow = {
  ashedMemberId: string;
  memberName: string;
  highestBaseVr: number;
  instituteLevel: number;
  totalHeroPower: number;
  weeklyPassActive: boolean;
  flagged: boolean;
  flagReason: string | null;
};

export type TakedownTeam = {
  teamIndex: number;
  rallyLead: LeaderboardRow;
  fillers: LeaderboardRow[];
  effectiveVr: number;
};

export type TakedownTeamsResult =
  | { ok: true; teams: TakedownTeam[] }
  | { ok: false; error: "insufficient_players"; needed: number; have: number };

export function memberTotalHeroPower(member: AshedMember): number {
  const record = member as AshedMember & {
    total_hero_power?: number;
    totalHeroPower?: number;
    hero_power?: number;
    heroPowerM?: number | null;
  };
  const fromHeroPowerM =
    record.heroPowerM != null && record.heroPowerM > 0
      ? Math.round(record.heroPowerM * 1_000_000)
      : undefined;
  return (
    record.total_hero_power ??
    record.totalHeroPower ??
    record.hero_power ??
    fromHeroPowerM ??
    0
  );
}

export function buildLeaderboardRows(
  seasonRows: MemberSeasonVr[],
  members: AshedMember[],
  links: Array<{ ashedMemberId: string; memberDisplayName: string | null }>,
  seasonKey: string,
  weeklyPassByMemberId?: ReadonlyMap<string, boolean>,
): LeaderboardRow[] {
  const memberById = new Map(members.map((m) => [m.id, m]));
  const linkNameById = new Map(
    links.map((l) => [l.ashedMemberId, l.memberDisplayName]),
  );

  return seasonRows
    .map((row) => {
      const member = memberById.get(row.ashedMemberId);
      const memberName =
        linkNameById.get(row.ashedMemberId) ??
        member?.current_name ??
        row.ashedMemberId;
      const instituteLevel =
        row.instituteLevel ??
        coerceInstituteLevelFromBaseVr(seasonKey, row.highestBaseVr);
      return {
        ashedMemberId: row.ashedMemberId,
        memberName,
        highestBaseVr: row.highestBaseVr,
        instituteLevel,
        totalHeroPower: member ? memberTotalHeroPower(member) : 0,
        weeklyPassActive: weeklyPassByMemberId?.get(row.ashedMemberId) ?? false,
        flagged: row.flaggedAt != null,
        flagReason: row.flagReason,
      };
    })
    .sort((a, b) => {
      if (b.highestBaseVr !== a.highestBaseVr) {
        return b.highestBaseVr - a.highestBaseVr;
      }
      return b.totalHeroPower - a.totalHeroPower;
    });
}

export function formatVrLeaderboard(
  rows: LeaderboardRow[],
  seasonKey: string,
  options?: { limit?: number; allianceTag?: string | null },
): string {
  const limit = options?.limit ?? 25;
  if (rows.length === 0) {
    return `**Season ${seasonKey} VR report** — no reports yet today.`;
  }
  const tagSuffix = options?.allianceTag ? ` (${options.allianceTag})` : "";
  const lines = rows.slice(0, limit).map((row, index) => {
    const flag = row.flagged ? " ⚠️" : "";
    return `${index + 1}. **${row.memberName}** — ${row.highestBaseVr} VR (THP ${row.totalHeroPower.toLocaleString()})${flag}`;
  });
  return [`**Season ${seasonKey} base VR standings${tagSuffix}**`, ...lines].join(
    "\n",
  );
}

export function formatDailyDiscordReport(
  rows: LeaderboardRow[],
  seasonKey: string,
): string {
  return formatVrLeaderboard(rows, seasonKey, { limit: 25 });
}

/** Assign filler slots across teams in snake order to balance THP per team. */
function assignFillersSnakeDraft(
  fillers: LeaderboardRow[],
  teamCount: number,
): LeaderboardRow[][] {
  return assignSnakeDraft(fillers, teamCount, 4);
}

export function buildTakedownTeams(
  rows: LeaderboardRow[],
  teamCount: number,
): TakedownTeamsResult {
  if (teamCount < 1) {
    return { ok: false, error: "insufficient_players", needed: 5, have: rows.length };
  }

  const needed = teamCount * 5;
  if (rows.length < needed) {
    return { ok: false, error: "insufficient_players", needed, have: rows.length };
  }

  const leads = rows.slice(0, teamCount);
  const pool = rows
    .slice(teamCount)
    .slice()
    .sort((a, b) => b.totalHeroPower - a.totalHeroPower);
  const fillers = pool.slice(0, teamCount * 4);
  const fillerGroups = assignFillersSnakeDraft(fillers, teamCount);

  const teams: TakedownTeam[] = leads.map((lead, index) => ({
    teamIndex: index + 1,
    rallyLead: lead,
    fillers: fillerGroups[index] ?? [],
    effectiveVr: effectiveBaseVr(lead.highestBaseVr, lead.weeklyPassActive),
  }));

  return { ok: true, teams };
}

export function formatTakedownReport(
  teams: TakedownTeam[],
  seasonKey: string,
  allianceTag: string | null,
): string {
  const tagSuffix = allianceTag ? ` (${allianceTag})` : "";
  const header = `**Season ${seasonKey} — ${teams.length} takedown teams${tagSuffix}**`;
  const blocks = teams.map((team) => {
    const leadLine = `**Team ${team.teamIndex}** — Lead **${team.rallyLead.memberName}** · ${team.effectiveVr} VR (THP ${team.rallyLead.totalHeroPower.toLocaleString()})`;
    const fillerLines = team.fillers.map((filler, index) => {
      return `  ${index + 2}. ${filler.memberName} · THP ${filler.totalHeroPower.toLocaleString()} (inherits ${team.effectiveVr} VR)`;
    });
    return [leadLine, ...fillerLines].join("\n");
  });
  return [header, ...blocks].join("\n\n");
}
