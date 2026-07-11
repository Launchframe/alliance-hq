import "server-only";

import type { DiscordBotLocale } from "@/lib/discord/i18n";
import { createDiscordTranslator } from "@/lib/discord/i18n";
import {
  getMyWlTeam,
  resolveCommanderForDiscordUser,
  switchProfession,
  updateCommanderProfession,
} from "@/lib/professions/service";
import { upsertProfessionChannel } from "@/lib/professions/repository";
import { callerIsAllianceOwner, resolveAllianceForGuild } from "@/lib/vr/repository";

const APP_URL = process.env.NEXTAUTH_URL?.replace(/\/$/, "") ?? "https://frontline.gay";

export type ProfessionBotReply = {
  reply: string;
  showProfessionSelect?: boolean;
  showSwitchConfirm?: string;
};

// ---------------------------------------------------------------------------
// /switch-profession
// ---------------------------------------------------------------------------

export async function handleDiscordSwitchProfession(input: {
  guildId: string | null;
  discordUserId: string;
  locale: DiscordBotLocale;
}): Promise<ProfessionBotReply> {
  const t = createDiscordTranslator(input.locale);
  const allianceId = await resolveAllianceForGuild(input.guildId);

  if (!allianceId) {
    return { reply: t("errors.guildNotRegistered") };
  }

  const ctx = await resolveCommanderForDiscordUser(input.discordUserId, allianceId);
  if (!ctx) {
    return { reply: t("errors.hqLinkRequired") };
  }

  if (!ctx.profession) {
    return {
      reply: t("profession.noProfessionSelect"),
      showProfessionSelect: true,
    };
  }

  const opposite =
    ctx.profession === "Engineer" ? "War Leader" : "Engineer";

  return {
    reply: t("profession.switchConfirm", {
      current: ctx.profession,
      opposite,
    }),
    showSwitchConfirm: opposite,
  };
}

// ---------------------------------------------------------------------------
// Profession select button (first-time, no profession set)
// ---------------------------------------------------------------------------

export async function handleDiscordProfessionSelect(input: {
  guildId: string | null;
  discordUserId: string;
  profession: "Engineer" | "War Leader";
  locale: DiscordBotLocale;
}): Promise<ProfessionBotReply> {
  const t = createDiscordTranslator(input.locale);
  const allianceId = await resolveAllianceForGuild(input.guildId);

  if (!allianceId) {
    return { reply: t("errors.guildNotRegistered") };
  }

  const ctx = await resolveCommanderForDiscordUser(input.discordUserId, allianceId);
  if (!ctx) {
    return { reply: t("errors.hqLinkRequired") };
  }

  await updateCommanderProfession(ctx.commanderId, input.profession, allianceId);

  if (input.profession === "Engineer") {
    return {
      reply: t("profession.nowEngineer", { appUrl: APP_URL }),
    };
  }

  return {
    reply: t("profession.nowWarLeader", { appUrl: APP_URL }),
  };
}

// ---------------------------------------------------------------------------
// Profession switch confirm button
// ---------------------------------------------------------------------------

export async function handleDiscordProfessionSwitchConfirm(input: {
  guildId: string | null;
  discordUserId: string;
  answer: "yes" | "no";
  locale: DiscordBotLocale;
}): Promise<ProfessionBotReply> {
  const t = createDiscordTranslator(input.locale);
  if (input.answer === "no") {
    return { reply: t("profession.switchCancelled") };
  }

  const allianceId = await resolveAllianceForGuild(input.guildId);

  if (!allianceId) {
    return { reply: t("errors.guildNotRegistered") };
  }

  const ctx = await resolveCommanderForDiscordUser(input.discordUserId, allianceId);
  if (!ctx) {
    return { reply: t("errors.hqLinkRequired") };
  }

  if (!ctx.profession) {
    return {
      reply: t("profession.noProfessionSet"),
      showProfessionSelect: true,
    };
  }

  const toProfession =
    ctx.profession === "Engineer" ? "War Leader" : ("Engineer" as const);
  const fromProfession = ctx.profession as "Engineer" | "War Leader";

  const { freedEngs } = await switchProfession({
    allianceId,
    commanderId: ctx.commanderId,
    fromProfession,
    toProfession,
  });

  if (toProfession === "Engineer") {
    const lines = [
      t("profession.switchedToEngineer"),
      t("profession.findWlPrompt", { appUrl: APP_URL }),
    ];
    if (fromProfession === "War Leader" && freedEngs.length > 0) {
      lines.push(
        t("profession.freedEngsNotice", { count: String(freedEngs.length) }),
      );
    }
    return { reply: lines.join("\n") };
  }

  return {
    reply: [
      t("profession.switchedToWarLeader"),
      t("profession.setupTeamPrompt", { appUrl: APP_URL }),
    ].join("\n"),
  };
}

// ---------------------------------------------------------------------------
// /my-engineers
// ---------------------------------------------------------------------------

export async function handleDiscordMyEngineers(input: {
  guildId: string | null;
  discordUserId: string;
  locale: DiscordBotLocale;
}): Promise<ProfessionBotReply> {
  const t = createDiscordTranslator(input.locale);
  const allianceId = await resolveAllianceForGuild(input.guildId);

  if (!allianceId) {
    return { reply: t("errors.guildNotRegistered") };
  }

  const ctx = await resolveCommanderForDiscordUser(input.discordUserId, allianceId);
  if (!ctx) {
    return { reply: t("errors.hqLinkRequired") };
  }

  if (ctx.profession !== "War Leader") {
    return { reply: t("profession.warLeaderOnly") };
  }

  const teamCtx = await getMyWlTeam(allianceId, ctx.commanderId);

  if (!teamCtx.activeEngs.length) {
    return {
      reply: [
        t("profession.teamHeader"),
        t("profession.noEngineers"),
        t("profession.teamDashboard", { appUrl: APP_URL }),
      ].join("\n"),
    };
  }

  const engLines = teamCtx.activeEngs.map((eng) => {
    const name = eng.engName ?? eng.engCommanderId;
    const coverage =
      eng.coverageStartHour !== null && eng.coverageEndHour !== null
        ? ` · ${String(eng.coverageStartHour).padStart(2, "0")}:00–${String(eng.coverageEndHour).padStart(2, "0")}:00 UTC`
        : "";
    const since = new Date(eng.assignedAt).toLocaleDateString();
    return t("profession.engLine", { name, coverage, since });
  });

  const covered = teamCtx.isCovered
    ? t("profession.covered")
    : t("profession.needsSupport", {
        count: String(teamCtx.activeEngs.length),
        min: String(teamCtx.minEngsPerTeam),
      });

  return {
    reply: [
      t("profession.teamHeaderCovered", { status: covered }),
      ...engLines,
      "",
      t("profession.fullDashboard", { appUrl: APP_URL }),
    ].join("\n"),
  };
}

// ---------------------------------------------------------------------------
// /set-profession-channel
// ---------------------------------------------------------------------------

export async function handleDiscordSetProfessionChannel(input: {
  guildId: string;
  channelId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
}): Promise<ProfessionBotReply> {
  const t = createDiscordTranslator(input.locale);
  const allianceId = await resolveAllianceForGuild(input.guildId);
  if (!allianceId) {
    return { reply: t("errors.guildNotRegistered") };
  }

  const isOwner = await callerIsAllianceOwner({
    allianceId,
    discordUserId: input.discordUserId,
  });
  if (!isOwner) {
    return { reply: t("profession.notOwner") };
  }

  await upsertProfessionChannel(allianceId, input.guildId, input.channelId);
  return {
    reply: t("profession.channelSet", { channelId: input.channelId }),
  };
}
