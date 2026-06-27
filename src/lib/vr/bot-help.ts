import {
  createDiscordTranslator,
  type DiscordBotLocale,
} from "@/lib/discord/i18n";
import {
  formatHelpReply,
  pickHelpMessageKey,
  resolveDiscordBotUserContext,
} from "@/lib/vr/bot-user-context";
import { writeDiscordBotAudit } from "@/lib/vr/repository";

export async function handleDiscordHelp(input: {
  guildId: string | null;
  discordUserId: string;
  locale: DiscordBotLocale;
}): Promise<{ reply: string }> {
  const ctx = await resolveDiscordBotUserContext({
    guildId: input.guildId,
    discordUserId: input.discordUserId,
  });
  const t = createDiscordTranslator(input.locale);
  const key = pickHelpMessageKey(ctx);
  const reply = formatHelpReply(t, key, ctx, input.locale);

  if (ctx.allianceId) {
    try {
      await writeDiscordBotAudit({
        allianceId: ctx.allianceId,
        discordUserId: input.discordUserId,
        command: "help",
        payload: { helpKey: key },
        result: { memberLinkCount: ctx.memberLinkCount },
      });
    } catch (error) {
      console.error("[discord-bot] help audit failed", error);
    }
  }

  return { reply };
}
