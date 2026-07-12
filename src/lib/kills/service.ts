import "server-only";

import type { DiscordBotLocale } from "@/lib/discord/i18n";
import { createDiscordTranslator } from "@/lib/discord/i18n";
import { isKillsConfirmPending } from "@/lib/discord/bot-pending-guards.shared";
import { peerMaxKillsExcludingCommander } from "@/lib/kills/anomaly";
import {
  processKillsCommand,
  processKillsConfirmation,
} from "@/lib/kills/command";
import {
  countAllianceKillsReporters,
  getCommanderIdForMember,
  getCommanderKillsState,
  getCommanderMembershipInAlliance,
  listAllianceCommanderKillsRows,
  upsertCommanderKills,
} from "@/lib/kills/repository";
import type { KillsCommandResult, KillsPendingState } from "@/lib/kills/types";
import { ensureDiscordMemberLinksFromHq } from "@/lib/member-link/inherit-hq-to-discord.server";
import {
  getDiscordBotPending,
  getDiscordLinkById,
  listDiscordLinksForUser,
  saveDiscordBotPending,
  writeDiscordBotAudit,
} from "@/lib/vr/repository";

function botContext(locale: DiscordBotLocale) {
  return { translate: createDiscordTranslator(locale) };
}

async function audit(
  allianceId: string | null,
  discordUserId: string,
  command: string,
  payload: unknown,
  result: unknown,
) {
  if (!allianceId) return;
  try {
    await writeDiscordBotAudit({
      allianceId,
      discordUserId,
      command,
      payload,
      result,
    });
  } catch (error) {
    console.error("[discord-bot] kills audit log failed", error);
  }
}

async function resolveTargetLink(input: {
  allianceId: string;
  discordUserId: string;
  linkId?: string | null;
}) {
  if (input.linkId) {
    const link = await getDiscordLinkById(input.linkId);
    if (!link || link.allianceId !== input.allianceId) return null;
    if (link.discordUserId !== input.discordUserId) return null;
    return link;
  }
  let links = await listDiscordLinksForUser(input.allianceId, input.discordUserId);
  if (links.length === 0) {
    await ensureDiscordMemberLinksFromHq({
      discordUserId: input.discordUserId,
      allianceId: input.allianceId,
    });
    links = await listDiscordLinksForUser(input.allianceId, input.discordUserId);
  }
  if (links.length === 0) return null;
  if (links.length === 1) return links[0]!;
  return "pick" as const;
}

async function runKillsForLink(input: {
  allianceId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
  ashedMemberId: string;
  memberDisplayName: string | null;
  explicitTotal?: number | null;
}): Promise<KillsCommandResult> {
  const { translate } = botContext(input.locale);
  const commanderId = await getCommanderIdForMember(
    input.allianceId,
    input.ashedMemberId,
  );
  if (!commanderId) {
    return {
      reply: translate("kills.commanderNotFound"),
      pending: null,
      action: { type: "none" },
    };
  }

  const pendingRow = await getDiscordBotPending(input.discordUserId);
  const pending = (pendingRow?.pending ?? null) as KillsPendingState | null;
  const commander = await getCommanderKillsState(commanderId);
  const [reporterCount, allianceRows] = await Promise.all([
    countAllianceKillsReporters(input.allianceId),
    listAllianceCommanderKillsRows(input.allianceId),
  ]);
  const peerMax = peerMaxKillsExcludingCommander(
    allianceRows
      .filter((row) => row.total != null)
      .map((row) => ({ commanderId: row.commanderId, total: row.total! })),
    commanderId,
  );

  const result = processKillsCommand({
    explicitTotal: input.explicitTotal ?? null,
    currentTotal: commander?.currentKills ?? null,
    commanderId,
    pending,
    reporterCount,
    peerMax,
    translate,
  });

  await saveDiscordBotPending(input.allianceId, input.discordUserId, result.pending);

  if (result.action.type === "set_kills") {
    await upsertCommanderKills({
      commanderId,
      total: result.action.total,
      allianceId: input.allianceId,
      ashedMemberId: input.ashedMemberId,
      memberName: input.memberDisplayName ?? input.ashedMemberId,
      source: "discord",
      discordUserId: input.discordUserId,
    });
    await saveDiscordBotPending(input.allianceId, input.discordUserId, null);
  }

  return result;
}

export async function handleDiscordKillsSlash(input: {
  allianceId: string;
  discordUserId: string;
  explicitTotal?: number | null;
  linkId?: string | null;
  locale: DiscordBotLocale;
}): Promise<KillsCommandResult> {
  const { translate } = botContext(input.locale);
  const target = await resolveTargetLink(input);
  if (target === null) {
    const result: KillsCommandResult = {
      reply: translate("kills.notLinked"),
      pending: null,
      action: { type: "none" },
    };
    await audit(input.allianceId, input.discordUserId, "kills", input, result);
    return result;
  }
  if (target === "pick") {
    const links = await listDiscordLinksForUser(
      input.allianceId,
      input.discordUserId,
    );
    const result: KillsCommandResult = {
      reply: translate("kills.pickCharacter"),
      pending: {
        kind: "pick_character",
        linkIds: links.map((l) => l.id),
        proposedTotal: input.explicitTotal ?? null,
      },
      action: { type: "none" },
      characterPicker: links.map((l) => ({
        linkId: l.id,
        label: l.memberDisplayName ?? l.ashedMemberId,
      })),
    };
    await saveDiscordBotPending(
      input.allianceId,
      input.discordUserId,
      result.pending,
    );
    await audit(input.allianceId, input.discordUserId, "kills", input, result);
    return result;
  }

  const result = await runKillsForLink({
    allianceId: input.allianceId,
    discordUserId: input.discordUserId,
    locale: input.locale,
    ashedMemberId: target.ashedMemberId,
    memberDisplayName: target.memberDisplayName,
    explicitTotal: input.explicitTotal,
  });
  await audit(input.allianceId, input.discordUserId, "kills", input, result);
  return result;
}

export async function handleDiscordKillsCharacterPick(input: {
  allianceId: string;
  discordUserId: string;
  linkId: string;
  locale: DiscordBotLocale;
}): Promise<KillsCommandResult> {
  const { translate } = botContext(input.locale);
  const link = await getDiscordLinkById(input.linkId);
  if (!link || link.discordUserId !== input.discordUserId) {
    const result: KillsCommandResult = {
      reply: translate("errors.nothingPending"),
      pending: null,
      action: { type: "none" },
    };
    await audit(
      input.allianceId,
      input.discordUserId,
      "kills_character",
      input,
      result,
    );
    return result;
  }

  const pendingRow = await getDiscordBotPending(input.discordUserId);
  const pending = pendingRow?.pending as KillsPendingState | null;
  const explicitTotal =
    pending?.kind === "pick_character" ? (pending.proposedTotal ?? null) : null;

  const result = await runKillsForLink({
    allianceId: input.allianceId,
    discordUserId: input.discordUserId,
    locale: input.locale,
    ashedMemberId: link.ashedMemberId,
    memberDisplayName: link.memberDisplayName,
    explicitTotal,
  });
  await audit(
    input.allianceId,
    input.discordUserId,
    "kills_character",
    input,
    result,
  );
  return result;
}

export async function handleDiscordKillsButtonConfirm(input: {
  allianceId: string;
  discordUserId: string;
  answer: "yes" | "no";
  locale: DiscordBotLocale;
}): Promise<KillsCommandResult> {
  const { translate } = botContext(input.locale);
  const pendingRow = await getDiscordBotPending(input.discordUserId);
  const pending = pendingRow?.pending;
  if (!isKillsConfirmPending(pending)) {
    const result: KillsCommandResult = {
      reply: translate("errors.noConfirm"),
      pending: null,
      action: { type: "none" },
    };
    await audit(
      input.allianceId,
      input.discordUserId,
      "kills_confirm",
      input,
      result,
    );
    return result;
  }

  const allianceRows = await listAllianceCommanderKillsRows(input.allianceId);
  const peerMax = peerMaxKillsExcludingCommander(
    allianceRows
      .filter((row) => row.total != null)
      .map((row) => ({ commanderId: row.commanderId, total: row.total! })),
    pending.commanderId,
  );

  const result = processKillsConfirmation({
    answer: input.answer,
    pending,
    translate,
    peerMax,
  });
  await saveDiscordBotPending(input.allianceId, input.discordUserId, result.pending);

  if (result.action.type === "set_kills") {
    const membership = await getCommanderMembershipInAlliance(
      pending.commanderId,
      input.allianceId,
    );
    await upsertCommanderKills({
      commanderId: pending.commanderId,
      total: result.action.total,
      allianceId: input.allianceId,
      ashedMemberId: membership?.ashedMemberId,
      memberName:
        membership?.memberName ??
        membership?.ashedMemberId ??
        pending.commanderId,
      source: "discord",
      discordUserId: input.discordUserId,
    });
    await saveDiscordBotPending(input.allianceId, input.discordUserId, null);
  }

  await audit(
    input.allianceId,
    input.discordUserId,
    "kills_confirm",
    input,
    result,
  );
  return result;
}
