import { buildLeaderboardRows } from "@/lib/vr/leaderboard";
import { loadAllianceMembersForBot } from "@/lib/vr/member-roster";
import {
  getAllianceById,
  listDiscordLinksByAlliance,
  listLeaderboardRows,
  resolveSeasonKey,
} from "@/lib/vr/repository";

export async function loadAllianceLeaderboard(allianceId: string) {
  const seasonKey = await resolveSeasonKey(allianceId);
  const [seasonRows, links, members, alliance] = await Promise.all([
    listLeaderboardRows(allianceId, seasonKey),
    listDiscordLinksByAlliance(allianceId),
    loadAllianceMembersForBot(allianceId),
    getAllianceById(allianceId),
  ]);
  const rows = buildLeaderboardRows(seasonRows, members, links);
  return { seasonKey, allianceTag: alliance?.tag ?? null, rows };
}
