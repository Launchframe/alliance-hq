import { loadAllianceMembersForBot } from "@/lib/vr/member-roster";
import {
  listDiscordLinksByAlliance,
  listFlaggedSeasonVr,
  listLeaderboardRows,
  resolveSeasonKey,
} from "@/lib/vr/repository";
import { buildLeaderboardRows, type LeaderboardRow } from "@/lib/vr/leaderboard";

export type ViralResistancePayload = {
  seasonKey: string;
  rows: LeaderboardRow[];
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
): Promise<ViralResistancePayload> {
  const seasonKey = await resolveSeasonKey(allianceId);
  const [seasonRows, links, members] = await Promise.all([
    listLeaderboardRows(allianceId, seasonKey),
    listDiscordLinksByAlliance(allianceId),
    loadAllianceMembersForBot(allianceId),
  ]);
  return {
    seasonKey,
    rows: buildLeaderboardRows(seasonRows, members, links, seasonKey),
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
