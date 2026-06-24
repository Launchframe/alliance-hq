import "server-only";

import {
  getAllianceTrainDiscordAnnouncementsEnabled,
  listGuildTrainChannelsForAlliance,
  setAllianceTrainDiscordAnnouncementsEnabled,
} from "@/lib/vr/repository";

export type TrainDiscordSettings = {
  announcementsEnabled: boolean;
  guildChannelCount: number;
  canManage: boolean;
};

export async function loadTrainDiscordSettings(
  allianceId: string,
  canManage: boolean,
): Promise<TrainDiscordSettings> {
  const [announcementsEnabled, channels] = await Promise.all([
    getAllianceTrainDiscordAnnouncementsEnabled(allianceId),
    listGuildTrainChannelsForAlliance(allianceId),
  ]);
  return {
    announcementsEnabled,
    guildChannelCount: channels.length,
    canManage,
  };
}

export async function saveTrainDiscordSettings(
  allianceId: string,
  announcementsEnabled: boolean,
): Promise<TrainDiscordSettings> {
  await setAllianceTrainDiscordAnnouncementsEnabled(
    allianceId,
    announcementsEnabled,
  );
  return loadTrainDiscordSettings(allianceId, true);
}

export function trainDiscordConfigured(settings: TrainDiscordSettings): boolean {
  return settings.announcementsEnabled && settings.guildChannelCount > 0;
}
