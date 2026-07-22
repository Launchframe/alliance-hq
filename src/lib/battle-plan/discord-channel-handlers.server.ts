import "server-only";

import { resolveDiscordChannelSetterAccess } from "@/lib/discord/channel-setter-auth.server";
import {
  createDiscordTranslator,
  type DiscordBotLocale,
} from "@/lib/discord/i18n";
import {
  getAllianceById,
  getGuildAllianceId,
  setGuildBankingChannel,
  setGuildRegularEventsChannel,
  setGuildSeasonalEventsChannel,
} from "@/lib/vr/repository";

type BotReply = { reply: string };

async function guardChannelSetter(input: {
  guildId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
}): Promise<{ allianceId: string } | { reply: string }> {
  const t = createDiscordTranslator(input.locale);
  const allianceId = await getGuildAllianceId(input.guildId);
  if (!allianceId) return { reply: t("errors.guildNotRegistered") };

  const access = await resolveDiscordChannelSetterAccess({
    allianceId,
    discordUserId: input.discordUserId,
  });
  if (!access.allowed) return { reply: t(access.denialKey) };

  return { allianceId };
}

export async function handleDiscordSetSeasonalEventsChannel(input: {
  guildId: string;
  channelId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
}): Promise<BotReply> {
  const t = createDiscordTranslator(input.locale);
  const gated = await guardChannelSetter(input);
  if ("reply" in gated) return gated;

  await setGuildSeasonalEventsChannel(input.guildId, input.channelId);
  const alliance = await getAllianceById(gated.allianceId);
  return {
    reply: t("channelSetter.seasonalEventsSuccess", {
      tag: alliance?.tag ?? "?",
      channel: `<#${input.channelId}>`,
    }),
  };
}

export async function handleDiscordSetRegularEventsChannel(input: {
  guildId: string;
  channelId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
}): Promise<BotReply> {
  const t = createDiscordTranslator(input.locale);
  const gated = await guardChannelSetter(input);
  if ("reply" in gated) return gated;

  await setGuildRegularEventsChannel(input.guildId, input.channelId);
  const alliance = await getAllianceById(gated.allianceId);
  return {
    reply: t("channelSetter.regularEventsSuccess", {
      tag: alliance?.tag ?? "?",
      channel: `<#${input.channelId}>`,
    }),
  };
}

export async function handleDiscordSetBankingChannel(input: {
  guildId: string;
  channelId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
}): Promise<BotReply> {
  const t = createDiscordTranslator(input.locale);
  const gated = await guardChannelSetter(input);
  if ("reply" in gated) return gated;

  await setGuildBankingChannel(input.guildId, input.channelId);
  const alliance = await getAllianceById(gated.allianceId);
  return {
    reply: t("channelSetter.bankingSuccess", {
      tag: alliance?.tag ?? "?",
      channel: `<#${input.channelId}>`,
    }),
  };
}
