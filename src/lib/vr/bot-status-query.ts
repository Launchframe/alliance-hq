import {
  createDiscordTranslator,
  type DiscordBotLocale,
} from "@/lib/discord/i18n";
import { getCommanderThpState, getCommanderIdForMember } from "@/lib/thp/repository";
import { effectiveBaseVr } from "@/lib/vr/effective-vr.shared";
import { instituteLevelForBaseVr } from "@/lib/vr/institute-levels.shared";
import { ensureDiscordMemberLinksFromHq } from "@/lib/member-link/inherit-hq-to-discord.server";
import {
  getCommanderByAshedMemberId,
  getMemberSeasonHigh,
  listDiscordLinksForUser,
  resolveSeasonKey,
  writeDiscordBotAudit,
} from "@/lib/vr/repository";

export type StatusQueryReply = { reply: string };

async function listLinksForQuery(allianceId: string, discordUserId: string) {
  let links = await listDiscordLinksForUser(allianceId, discordUserId);
  if (links.length === 0) {
    await ensureDiscordMemberLinksFromHq({ discordUserId, allianceId });
    links = await listDiscordLinksForUser(allianceId, discordUserId);
  }
  return links;
}

async function auditQuery(
  allianceId: string,
  discordUserId: string,
  command: string,
  result: StatusQueryReply,
) {
  try {
    await writeDiscordBotAudit({
      allianceId,
      discordUserId,
      command,
      payload: {},
      result,
    });
  } catch (error) {
    console.error(`[discord-bot] ${command} audit failed`, error);
  }
}

/** Public channel query: caller's current institute level / VR this season. */
export async function handleDiscordWhatIsMyVr(input: {
  allianceId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
}): Promise<StatusQueryReply> {
  const t = createDiscordTranslator(input.locale);
  const links = await listLinksForQuery(input.allianceId, input.discordUserId);
  if (links.length === 0) {
    const reply = { reply: t("query.vrNotLinked") };
    await auditQuery(input.allianceId, input.discordUserId, "what_is_my_vr", reply);
    return reply;
  }

  const seasonKey = await resolveSeasonKey(input.allianceId);
  const lines: string[] = [];

  for (const link of links) {
    const name = link.memberDisplayName ?? link.ashedMemberId;
    const [seasonHigh, commander] = await Promise.all([
      getMemberSeasonHigh(input.allianceId, link.ashedMemberId, seasonKey),
      getCommanderByAshedMemberId(link.ashedMemberId, input.allianceId),
    ]);

    if (seasonHigh == null) {
      lines.push(t("query.vrNoReport", { name }));
      continue;
    }

    const level = instituteLevelForBaseVr(seasonKey, seasonHigh) ?? "?";
    const effectiveVr = effectiveBaseVr(
      seasonHigh,
      commander?.weeklyPassActive ?? false,
    );
    lines.push(
      t("query.vrStatus", {
        name,
        level,
        effectiveVr,
      }),
    );
  }

  const reply = {
    reply:
      links.length === 1
        ? lines[0]!
        : `${t("query.vrHeader")}\n${lines.map((line) => `• ${line}`).join("\n")}`,
  };
  await auditQuery(input.allianceId, input.discordUserId, "what_is_my_vr", reply);
  return reply;
}

/** Public channel query: caller's current total hero power. */
export async function handleDiscordWhatIsMyThp(input: {
  allianceId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
}): Promise<StatusQueryReply> {
  const t = createDiscordTranslator(input.locale);
  const links = await listLinksForQuery(input.allianceId, input.discordUserId);
  if (links.length === 0) {
    const reply = { reply: t("query.thpNotLinked") };
    await auditQuery(input.allianceId, input.discordUserId, "what_is_my_thp", reply);
    return reply;
  }

  const lines: string[] = [];

  for (const link of links) {
    const name = link.memberDisplayName ?? link.ashedMemberId;
    const commanderId = await getCommanderIdForMember(
      input.allianceId,
      link.ashedMemberId,
    );
    if (!commanderId) {
      lines.push(t("query.thpNoReport", { name }));
      continue;
    }
    const state = await getCommanderThpState(commanderId);
    const total = state?.currentTotalHeroPower;
    if (total == null || !(total > 0)) {
      lines.push(t("query.thpNoReport", { name }));
      continue;
    }
    lines.push(
      t("query.thpStatus", {
        name,
        total: Math.round(total).toLocaleString(),
      }),
    );
  }

  const reply = {
    reply:
      links.length === 1
        ? lines[0]!
        : `${t("query.thpHeader")}\n${lines.map((line) => `• ${line}`).join("\n")}`,
  };
  await auditQuery(input.allianceId, input.discordUserId, "what_is_my_thp", reply);
  return reply;
}
