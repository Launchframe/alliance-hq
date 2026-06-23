import "server-only";

import type { DiscordBotLocale } from "@/lib/discord/i18n";
import { createDiscordTranslator } from "@/lib/discord/i18n";
import { callerCanManageTrains } from "@/lib/trains/discord-bot-auth.server";
import { formatTrainStatusReply } from "@/lib/trains/discord-bot.shared";
import {
  draftConductorForAlliance,
  lockTrainAndAnnounce,
} from "@/lib/trains/discord-bot.server";
import { getConductorRecord } from "@/lib/trains/repository";
import { getServerCalendarDate } from "@/lib/trains/service";
import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { findExactMemberByName } from "@/lib/vr/link-helpers";
import { loadAllianceMembersForBot } from "@/lib/vr/member-roster";
import {
  callerIsAllianceOwner,
  getAllianceById,
  getGuildAllianceId,
  setGuildTrainChannel,
  writeDiscordBotAudit,
} from "@/lib/vr/repository";
import { findFuzzyMemberCandidates } from "@/lib/video/member-matcher";

export type TrainBotReply = {
  reply: string;
  pickCandidates?: Array<{ memberId: string; name: string; date: string }>;
  pendingPick?: { memberId: string; memberName: string; date: string };
};

function parseTrainDate(raw: string | undefined): string {
  const trimmed = raw?.trim();
  if (trimmed && /^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  return getServerCalendarDate();
}

export async function handleDiscordSetTrainChannel(input: {
  guildId: string;
  channelId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
}): Promise<TrainBotReply> {
  const t = createDiscordTranslator(input.locale);
  const allianceId = await getGuildAllianceId(input.guildId);
  if (!allianceId) {
    const reply = t("errors.guildNotRegistered");
    return { reply };
  }

  const isOwner = await callerIsAllianceOwner({
    allianceId,
    discordUserId: input.discordUserId,
  });
  if (!isOwner) {
    const reply = t("errors.notOwner");
    await writeDiscordBotAudit({
      allianceId,
      discordUserId: input.discordUserId,
      command: "set_train_channel",
      payload: input,
      result: { reply },
    });
    return { reply };
  }

  await setGuildTrainChannel(input.guildId, input.channelId);
  const alliance = await getAllianceById(allianceId);
  const reply = t("train.setTrainChannel.success", {
    tag: alliance?.tag ?? "?",
    channel: `<#${input.channelId}>`,
  });
  await writeDiscordBotAudit({
    allianceId,
    discordUserId: input.discordUserId,
    command: "set_train_channel",
    payload: input,
    result: { reply },
  });
  return { reply };
}

export async function handleDiscordWhoIsConductor(input: {
  allianceId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
  date?: string;
}): Promise<TrainBotReply> {
  const t = createDiscordTranslator(input.locale);
  const date = parseTrainDate(input.date);
  const seasonKey = (await getEffectiveSeasonForAlliance(input.allianceId))
    .seasonKey;
  const record = await getConductorRecord(
    input.allianceId,
    date,
    seasonKey,
  );

  const reply = record
    ? formatTrainStatusReply({
        date,
        conductorMemberName: record.conductorMemberName,
        vipMemberName: record.vipMemberName,
        lockedAt: record.lockedAt?.toISOString() ?? null,
      })
    : t("train.noConductor", { date });

  await writeDiscordBotAudit({
    allianceId: input.allianceId,
    discordUserId: input.discordUserId,
    command: "who_is_conductor",
    payload: { date },
    result: { reply },
  });
  return { reply };
}

export async function handleDiscordSetConductor(input: {
  allianceId: string;
  guildId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
  name: string;
  date?: string;
}): Promise<TrainBotReply> {
  const t = createDiscordTranslator(input.locale);
  const allowed = await callerCanManageTrains({
    allianceId: input.allianceId,
    discordUserId: input.discordUserId,
  });
  if (!allowed) {
    const reply = t("errors.notOfficer");
    await writeDiscordBotAudit({
      allianceId: input.allianceId,
      discordUserId: input.discordUserId,
      command: "set_conductor",
      payload: input,
      result: { reply },
    });
    return { reply };
  }

  const date = parseTrainDate(input.date);
  const alliance = await getAllianceById(input.allianceId);
  const members = await loadAllianceMembersForBot(input.allianceId);
  if (members.length === 0) {
    const reply = t("train.rosterUnavailable");
    await writeDiscordBotAudit({
      allianceId: input.allianceId,
      discordUserId: input.discordUserId,
      command: "set_conductor",
      payload: input,
      result: { reply },
    });
    return { reply };
  }

  const exact = findExactMemberByName(members, input.name);
  if (exact) {
    return {
      reply: t("train.confirmPick", {
        name: exact.current_name,
        date,
      }),
      pendingPick: {
        memberId: exact.id,
        memberName: exact.current_name,
        date,
      },
    };
  }

  const candidates = findFuzzyMemberCandidates(input.name, members, {
    allianceTag: alliance?.tag,
    limit: 5,
  });
  if (candidates.length === 0) {
    const reply = t("train.rosterMiss", { tag: alliance?.tag ?? "?" });
    await writeDiscordBotAudit({
      allianceId: input.allianceId,
      discordUserId: input.discordUserId,
      command: "set_conductor",
      payload: input,
      result: { reply },
    });
    return { reply };
  }

  if (candidates.length === 1) {
    const only = candidates[0]!;
    return {
      reply: t("train.confirmPick", { name: only.name, date }),
      pendingPick: {
        memberId: only.memberId,
        memberName: only.name,
        date,
      },
    };
  }

  return {
    reply: t("train.fuzzyPrompt", { query: input.name.trim() }),
    pickCandidates: candidates.map((c) => ({
      memberId: c.memberId,
      name: c.name,
      date,
    })),
  };
}

export async function handleDiscordTrainConductorPick(input: {
  allianceId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
  memberId: string;
  date: string;
}): Promise<TrainBotReply> {
  const t = createDiscordTranslator(input.locale);
  const allowed = await callerCanManageTrains({
    allianceId: input.allianceId,
    discordUserId: input.discordUserId,
  });
  if (!allowed) {
    return { reply: t("errors.notOfficer") };
  }

  const members = await loadAllianceMembersForBot(input.allianceId);
  const member = members.find((m) => m.id === input.memberId);
  if (!member) {
    return { reply: t("train.pickExpired") };
  }

  try {
    await draftConductorForAlliance({
      allianceId: input.allianceId,
      date: input.date,
      memberId: member.id,
      memberName: member.current_name,
    });
    const reply = t("train.draftSaved", {
      name: member.current_name,
      date: input.date,
    });
    await writeDiscordBotAudit({
      allianceId: input.allianceId,
      discordUserId: input.discordUserId,
      command: "set_conductor_confirm",
      payload: input,
      result: { reply },
    });
    return { reply };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : t("errors.serverError");
    return { reply: message };
  }
}

export async function handleDiscordTrainIsReady(input: {
  allianceId: string;
  guildId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
  date?: string;
}): Promise<TrainBotReply> {
  const t = createDiscordTranslator(input.locale);
  const allowed = await callerCanManageTrains({
    allianceId: input.allianceId,
    discordUserId: input.discordUserId,
  });
  if (!allowed) {
    const reply = t("errors.notOfficer");
    await writeDiscordBotAudit({
      allianceId: input.allianceId,
      discordUserId: input.discordUserId,
      command: "train_is_ready",
      payload: input,
      result: { reply },
    });
    return { reply };
  }

  const date = parseTrainDate(input.date);
  try {
    const { record, announce } = await lockTrainAndAnnounce({
      allianceId: input.allianceId,
      date,
      guildId: input.guildId,
    });
    const reply =
      announce.posted > 0
        ? t("train.readyAnnounced", {
            name: record.conductorMemberName ?? "?",
            date,
          })
        : t("train.readyLocked", {
            name: record.conductorMemberName ?? "?",
            date,
          });
    await writeDiscordBotAudit({
      allianceId: input.allianceId,
      discordUserId: input.discordUserId,
      command: "train_is_ready",
      payload: { date, announce },
      result: { reply },
    });
    return { reply };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : t("errors.serverError");
    await writeDiscordBotAudit({
      allianceId: input.allianceId,
      discordUserId: input.discordUserId,
      command: "train_is_ready",
      payload: input,
      result: { reply: message },
    });
    return { reply: message };
  }
}

export async function handleDiscordTrainConfirmPick(input: {
  allianceId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
  memberId: string;
  memberName: string;
  date: string;
}): Promise<TrainBotReply> {
  return handleDiscordTrainConductorPick({
    allianceId: input.allianceId,
    discordUserId: input.discordUserId,
    locale: input.locale,
    memberId: input.memberId,
    date: input.date,
  });
}
