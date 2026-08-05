import "server-only";

import { resolveDiscordChannelSetterAccess } from "@/lib/discord/channel-setter-auth.server";
import {
  createDiscordTranslator,
  type DiscordBotLocale,
} from "@/lib/discord/i18n";
import { getAllianceById, getGuildAllianceId, setGuildVsAnnouncementsChannel } from "@/lib/vr/repository";

type BotReply = { reply: string };

export async function handleDiscordSetVsAnnouncementsChannel(input: {
  guildId: string;
  channelId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
}): Promise<BotReply> {
  const t = createDiscordTranslator(input.locale);
  const allianceId = await getGuildAllianceId(input.guildId);
  if (!allianceId) return { reply: t("errors.guildNotRegistered") };

  const access = await resolveDiscordChannelSetterAccess({
    allianceId,
    discordUserId: input.discordUserId,
  });
  if (!access.allowed) return { reply: t(access.denialKey) };

  await setGuildVsAnnouncementsChannel(input.guildId, input.channelId);
  const alliance = await getAllianceById(allianceId);
  return {
    reply: t("channelSetter.vsAnnouncementsSuccess", {
      tag: alliance?.tag ?? "?",
      channel: `<#${input.channelId}>`,
    }),
  };
}
