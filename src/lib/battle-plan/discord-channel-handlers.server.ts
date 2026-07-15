import "server-only";

import {
  createDiscordTranslator,
  type DiscordBotLocale,
} from "@/lib/discord/i18n";
import {
  callerIsAllianceOwner,
  getAllianceById,
  getGuildAllianceId,
  setGuildBankingChannel,
  setGuildRegularEventsChannel,
  setGuildSeasonalEventsChannel,
} from "@/lib/vr/repository";

type BotReply = { reply: string };

export async function handleDiscordSetSeasonalEventsChannel(input: {
  guildId: string;
  channelId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
}): Promise<BotReply> {
  const t = createDiscordTranslator(input.locale);
  const allianceId = await getGuildAllianceId(input.guildId);
  if (!allianceId) return { reply: t("errors.guildNotRegistered") };

  const isOwner = await callerIsAllianceOwner({
    allianceId,
    discordUserId: input.discordUserId,
  });
  if (!isOwner) return { reply: t("errors.ownerOnly") };

  await setGuildSeasonalEventsChannel(input.guildId, input.channelId);
  const alliance = await getAllianceById(allianceId);
  return {
    reply: `✅ Seasonal events channel set for **${alliance?.tag ?? "?"}**. Capture countdowns will be posted to <#${input.channelId}>.`,
  };
}

export async function handleDiscordSetRegularEventsChannel(input: {
  guildId: string;
  channelId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
}): Promise<BotReply> {
  const t = createDiscordTranslator(input.locale);
  const allianceId = await getGuildAllianceId(input.guildId);
  if (!allianceId) return { reply: t("errors.guildNotRegistered") };

  const isOwner = await callerIsAllianceOwner({
    allianceId,
    discordUserId: input.discordUserId,
  });
  if (!isOwner) return { reply: t("errors.ownerOnly") };

  await setGuildRegularEventsChannel(input.guildId, input.channelId);
  const alliance = await getAllianceById(allianceId);
  return {
    reply: `✅ Regular events channel set for **${alliance?.tag ?? "?"}**. Event announcements will be posted to <#${input.channelId}>.`,
  };
}

export async function handleDiscordSetBankingChannel(input: {
  guildId: string;
  channelId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
}): Promise<BotReply> {
  const t = createDiscordTranslator(input.locale);
  const allianceId = await getGuildAllianceId(input.guildId);
  if (!allianceId) return { reply: t("errors.guildNotRegistered") };

  const isOwner = await callerIsAllianceOwner({
    allianceId,
    discordUserId: input.discordUserId,
  });
  if (!isOwner) return { reply: t("errors.ownerOnly") };

  await setGuildBankingChannel(input.guildId, input.channelId);
  const alliance = await getAllianceById(allianceId);
  return {
    reply: `✅ Banking channel set for **${alliance?.tag ?? "?"}**. Protection timer alerts will be posted to <#${input.channelId}>.`,
  };
}
