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
    rows: buildLeaderboardRows(seasonRows, members, links),
  };
}

export async function loadViralResistanceOfficerPanel(
  allianceId: string,
): Promise<ViralResistanceOfficerPayload> {
  const seasonKey = await resolveSeasonKey(allianceId);
  const flagged = await listFlaggedSeasonVr(allianceId, seasonKey);
  return { seasonKey, flagged };
}
