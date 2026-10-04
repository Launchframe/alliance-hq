export type TrainDiscordGuildLink = {
  guildId: string;
  /** Discord server name when the bot can read the guild; null falls back to ID suffix. */
  guildName: string | null;
  hasTrainChannel: boolean;
  trainChannelId: string | null;
  /** Discord channel name when configured and resolvable. */
  trainChannelName: string | null;
  discordOpenUrl: string;
};
