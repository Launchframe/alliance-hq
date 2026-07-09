import "server-only";

import type { DiscordBotLocale } from "@/lib/discord/i18n";
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
  const allianceId = await resolveAllianceForGuild(input.guildId);

  if (!allianceId) {
    return {
      reply:
        "This server is not registered with Alliance HQ. Use `/link-alliance` first.",
    };
  }

  const ctx = await resolveCommanderForDiscordUser(input.discordUserId, allianceId);
  if (!ctx) {
    return {
      reply:
        "Your Discord account is not linked to a commander in this alliance. Use `/link-commander` first.",
    };
  }

  if (!ctx.profession) {
    return {
      reply:
        "You don't have a profession set yet. Choose your role:",
      showProfessionSelect: true,
    };
  }

  const opposite =
    ctx.profession === "Engineer" ? "War Leader" : "Engineer";

  return {
    reply: `You are currently **${ctx.profession}**. Switch to **${opposite}**?`,
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
  const allianceId = await resolveAllianceForGuild(input.guildId);

  if (!allianceId) {
    return { reply: "Server not registered. Use `/link-alliance` first." };
  }

  const ctx = await resolveCommanderForDiscordUser(input.discordUserId, allianceId);
  if (!ctx) {
    return { reply: "Commander not linked. Use `/link-commander` first." };
  }

  await updateCommanderProfession(ctx.commanderId, input.profession, allianceId);

  if (input.profession === "Engineer") {
    return {
      reply: `You are now an **Engineer**! Visit ${APP_URL}/professions to find a War Leader to support.`,
    };
  }

  return {
    reply: `You are now a **War Leader**! Visit ${APP_URL}/professions to set up your Engineering team.`,
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
  if (input.answer === "no") {
    return { reply: "No changes made." };
  }

  const allianceId = await resolveAllianceForGuild(input.guildId);

  if (!allianceId) {
    return { reply: "Server not registered. Use `/link-alliance` first." };
  }

  const ctx = await resolveCommanderForDiscordUser(input.discordUserId, allianceId);
  if (!ctx) {
    return { reply: "Commander not linked. Use `/link-commander` first." };
  }

  if (!ctx.profession) {
    return {
      reply: "No profession set. Please select one:",
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
      `You are now an **Engineer**.`,
      `Visit ${APP_URL}/professions to find a War Leader to support.`,
    ];
    if (fromProfession === "War Leader" && freedEngs.length > 0) {
      lines.push(
        `Your ${freedEngs.length} assigned Engineer${freedEngs.length === 1 ? " has" : "s have"} been notified to find a new War Leader.`,
      );
    }
    return { reply: lines.join("\n") };
  }

  return {
    reply: [
      `You are now a **War Leader**.`,
      `Visit ${APP_URL}/professions to set up your Engineering team.`,
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
  const allianceId = await resolveAllianceForGuild(input.guildId);

  if (!allianceId) {
    return { reply: "Server not registered. Use `/link-alliance` first." };
  }

  const ctx = await resolveCommanderForDiscordUser(input.discordUserId, allianceId);
  if (!ctx) {
    return { reply: "Commander not linked. Use `/link-commander` first." };
  }

  if (ctx.profession !== "War Leader") {
    return {
      reply: "This command is for War Leaders only. Use `/switch-profession` to change your role.",
    };
  }

  const teamCtx = await getMyWlTeam(allianceId, ctx.commanderId);

  if (!teamCtx.activeEngs.length) {
    return {
      reply: [
        "**Your Engineering Team**",
        "No Engineers assigned yet.",
        `Visit ${APP_URL}/professions to see your team and request support.`,
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
    return `• **${name}**${coverage} (since ${since})`;
  });

  const covered = teamCtx.isCovered ? "Covered ✓" : `Needs support (${teamCtx.activeEngs.length}/${teamCtx.minEngsPerTeam})`;

  return {
    reply: [
      `**Your Engineering Team** — ${covered}`,
      ...engLines,
      "",
      `Full dashboard: ${APP_URL}/professions`,
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
  const allianceId = await resolveAllianceForGuild(input.guildId);
  if (!allianceId) {
    return { reply: "Server not registered. Use `/link-alliance` first." };
  }

  const isOwner = await callerIsAllianceOwner({
    allianceId,
    discordUserId: input.discordUserId,
  });
  if (!isOwner) {
    return {
      reply: "Only alliance owners can set the profession channel.",
    };
  }

  await upsertProfessionChannel(allianceId, input.guildId, input.channelId);
  return {
    reply: `Profession announcements will be posted to <#${input.channelId}>.`,
  };
}
