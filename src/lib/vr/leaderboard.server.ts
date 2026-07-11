import { buildLeaderboardRows } from "@/lib/vr/leaderboard";
import { loadCommanderRosterStatsByMember } from "@/lib/commanders/roster-stats.server";
import { loadAllianceMembersForBot } from "@/lib/vr/member-roster";
import {
  getAllianceById,
  listDiscordLinksByAlliance,
  listLeaderboardRows,
  listWeeklyPassActiveByAlliance,
  resolveSeasonKey,
} from "@/lib/vr/repository";

export async function loadAllianceLeaderboard(allianceId: string) {
  const seasonKey = await resolveSeasonKey(allianceId);
  const [seasonRows, links, members, alliance, weeklyPassByMemberId, commanderStats] =
    await Promise.all([
      listLeaderboardRows(allianceId, seasonKey),
      listDiscordLinksByAlliance(allianceId),
      loadAllianceMembersForBot(allianceId),
      getAllianceById(allianceId),
      listWeeklyPassActiveByAlliance(allianceId),
      loadCommanderRosterStatsByMember(allianceId),
    ]);
  const commanderThpByMemberId = new Map(
    [...commanderStats.entries()].map(([id, stats]) => [
      id,
      { currentTotalHeroPower: stats.totalHeroPower },
    ]),
  );
  const rows = buildLeaderboardRows(
    seasonRows,
    members,
    links,
    seasonKey,
    weeklyPassByMemberId,
    commanderThpByMemberId,
  );
  return { seasonKey, allianceTag: alliance?.tag ?? null, rows };
}
