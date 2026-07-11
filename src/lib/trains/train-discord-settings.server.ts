import "server-only";

import {
  getAllianceTrainDiscordAnnouncementsEnabled,
  listAllianceDiscordGuildTrainSetup,
  listGuildTrainChannelsForAlliance,
  setAllianceTrainDiscordAnnouncementsEnabled,
} from "@/lib/vr/repository";
import type { TrainDiscordGuildLink } from "@/lib/trains/train-discord-settings.shared";

export type { TrainDiscordGuildLink };

export type TrainDiscordSettings = {
  announcementsEnabled: boolean;
  guildChannelCount: number;
  guilds: TrainDiscordGuildLink[];
  canManage: boolean;
};

export async function loadTrainDiscordSettings(
  allianceId: string,
  canManage: boolean,
): Promise<TrainDiscordSettings> {
  const [announcementsEnabled, channels, guilds] = await Promise.all([
    getAllianceTrainDiscordAnnouncementsEnabled(allianceId),
    listGuildTrainChannelsForAlliance(allianceId),
    listAllianceDiscordGuildTrainSetup(allianceId),
  ]);
  return {
    announcementsEnabled,
    guildChannelCount: channels.length,
    guilds,
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
