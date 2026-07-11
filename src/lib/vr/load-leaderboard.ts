import { loadAllianceMembersForBot } from "@/lib/vr/member-roster";
import { loadVrProgressChartPayload } from "@/lib/vr/load-progress-chart";
import {
  listDiscordLinksByAlliance,
  listFlaggedSeasonVr,
  listLeaderboardRows,
  listWeeklyPassActiveByAlliance,
  resolveSeasonKey,
} from "@/lib/vr/repository";
import { buildLeaderboardRows, type LeaderboardRow } from "@/lib/vr/leaderboard";
import type { VrProgressChartPayload } from "@/lib/vr/vr-progress-chart.shared";
import { loadCommanderRosterStatsByMember } from "@/lib/commanders/roster-stats.server";

export type ViralResistancePayload = {
  seasonKey: string;
  rows: LeaderboardRow[];
  progressChart: VrProgressChartPayload;
};

export type ViralResistanceOfficerPayload = {
  seasonKey: string;
  flagged: Awaited<ReturnType<typeof listFlaggedSeasonVr>>;
  members: Array<{
    id: string;
    current_name: string;
    previous_names: string[];
  }>;
};

export async function loadViralResistanceLeaderboard(
  allianceId: string,
  viewer?: { ashedMemberId?: string | null; commanderId?: string | null },
): Promise<ViralResistancePayload> {
  const seasonKey = await resolveSeasonKey(allianceId);
  const [
    seasonRows,
    links,
    members,
    weeklyPassByMemberId,
    progressChart,
    commanderStats,
  ] = await Promise.all([
    listLeaderboardRows(allianceId, seasonKey),
    listDiscordLinksByAlliance(allianceId),
    loadAllianceMembersForBot(allianceId),
    listWeeklyPassActiveByAlliance(allianceId),
    loadVrProgressChartPayload({
      allianceId,
      viewerAshedMemberId: viewer?.ashedMemberId,
      viewerCommanderId: viewer?.commanderId,
    }),
    loadCommanderRosterStatsByMember(allianceId),
  ]);
  const commanderThpByMemberId = new Map(
    [...commanderStats.entries()].map(([id, stats]) => [
      id,
      { currentTotalHeroPower: stats.totalHeroPower },
    ]),
  );
  return {
    seasonKey,
    rows: buildLeaderboardRows(
      seasonRows,
      members,
      links,
      seasonKey,
      weeklyPassByMemberId,
      commanderThpByMemberId,
    ),
    progressChart,
  };
}

export async function loadViralResistanceOfficerPanel(
  allianceId: string,
): Promise<ViralResistanceOfficerPayload> {
  const seasonKey = await resolveSeasonKey(allianceId);
  const [flagged, members] = await Promise.all([
    listFlaggedSeasonVr(allianceId, seasonKey),
    loadAllianceMembersForBot(allianceId),
  ]);
  return {
    seasonKey,
    flagged,
    members: members.map((m) => ({
      id: m.id,
      current_name: m.current_name,
      previous_names: m.previous_names ?? [],
    })),
  };
}
