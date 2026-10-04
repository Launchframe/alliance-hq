import "server-only";

import { ActivityWriteError } from "@/lib/activity/errors.server";
import type { DiscordBotLocale, DiscordTranslate } from "@/lib/discord/i18n";
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
  KillsPendingChangedError,
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

async function runWithActivityErrors(
  translate: DiscordTranslate,
  work: () => Promise<KillsCommandResult>,
): Promise<KillsCommandResult> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof KillsPendingChangedError) {
      return {
        reply: translate("errors.noConfirm"),
        pending: null,
        action: { type: "none" },
      };
    }
    if (error instanceof ActivityWriteError) {
      return {
        reply: translate("activity.saveBlocked"),
        pending: null,
        action: { type: "none" },
      };
    }
    throw error;
  }
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
  let links = await listDiscordLinksForUser(input.allianceId, input.discordUserId, {
    rematerializeFormer: true,
  });
  if (links.length === 0) {
    await ensureDiscordMemberLinksFromHq({
      discordUserId: input.discordUserId,
      allianceId: input.allianceId,
    });
    links = await listDiscordLinksForUser(input.allianceId, input.discordUserId, {
      rematerializeFormer: true,
    });
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
  selectedPending?: Extract<KillsPendingState, { kind: "pick_character" }>;
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
  const pending = (
    pendingRow && pendingRow.allianceId === input.allianceId
      ? pendingRow.pending
      : null
  ) as KillsPendingState | null;
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
    previousUpdatedAt: commander?.killsUpdatedAt ?? null,
    commanderName:
      input.memberDisplayName ?? commander?.primaryName ?? input.ashedMemberId,
    commanderId,
    pending,
    reporterCount,
    peerMax,
    translate,
  });

  if (result.action.type === "set_kills") {
    const expectedPending = input.selectedPending ?? pending;
    await upsertCommanderKills({
      commanderId,
      total: result.action.total,
      allianceId: input.allianceId,
      ashedMemberId: input.ashedMemberId,
      memberName: input.memberDisplayName ?? input.ashedMemberId,
      source: "discord",
      discordUserId: input.discordUserId,
      activity: {
        identity: { kind: "discord", discordUserId: input.discordUserId },
        method: "manual",
        ...(expectedPending
          ? {
              pending: {
                expected: expectedPending,
                required: input.selectedPending != null,
              },
            }
          : {}),
      },
    });
    return result;
  }

  await saveDiscordBotPending(input.allianceId, input.discordUserId, result.pending);
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
      { rematerializeFormer: true },
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

  const result = await runWithActivityErrors(translate, () =>
    runKillsForLink({
      allianceId: input.allianceId,
      discordUserId: input.discordUserId,
      locale: input.locale,
      ashedMemberId: target.ashedMemberId,
      memberDisplayName: target.memberDisplayName,
      explicitTotal: input.explicitTotal,
    }),
  );
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
  const noPick: KillsCommandResult = {
    reply: translate("errors.nothingPending"),
    pending: null,
    action: { type: "none" },
  };
  const link = await getDiscordLinkById(input.linkId);
  if (
    !link ||
    link.discordUserId !== input.discordUserId ||
    link.allianceId !== input.allianceId
  ) {
    await audit(
      input.allianceId,
      input.discordUserId,
      "kills_character",
      input,
      noPick,
    );
    return noPick;
  }

  const pendingRow = await getDiscordBotPending(input.discordUserId);
  const pending =
    pendingRow && pendingRow.allianceId === input.allianceId
      ? pendingRow.pending
      : null;
  if (
    !pending ||
    pending.kind !== "pick_character" ||
    !("proposedTotal" in pending) ||
    !pending.linkIds.includes(input.linkId)
  ) {
    await audit(
      input.allianceId,
      input.discordUserId,
      "kills_character",
      input,
      noPick,
    );
    return noPick;
  }

  const killsPick = pending as Extract<
    KillsPendingState,
    { kind: "pick_character" }
  >;
  const result = await runWithActivityErrors(translate, () =>
    runKillsForLink({
      allianceId: input.allianceId,
      discordUserId: input.discordUserId,
      locale: input.locale,
      ashedMemberId: link.ashedMemberId,
      memberDisplayName: link.memberDisplayName,
      explicitTotal: killsPick.proposedTotal ?? null,
      selectedPending: killsPick,
    }),
  );
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
  const noConfirm: KillsCommandResult = {
    reply: translate("errors.noConfirm"),
    pending: null,
    action: { type: "none" },
  };
  const pendingRow = await getDiscordBotPending(input.discordUserId);
  const pending =
    pendingRow && pendingRow.allianceId === input.allianceId
      ? pendingRow.pending
      : null;
  if (!isKillsConfirmPending(pending)) {
    await audit(input.allianceId, input.discordUserId, "kills_confirm", input, noConfirm);
    return noConfirm;
  }

  const membership = await getCommanderMembershipInAlliance(
    pending.commanderId,
    input.allianceId,
  );
  const memberLinks = membership?.ashedMemberId
    ? await listDiscordLinksForUser(input.allianceId, input.discordUserId, {
        followLiveRoster: false,
      })
    : [];
  const confirmedLink = memberLinks.find(
    (link) => link.ashedMemberId === membership?.ashedMemberId,
  );
  if (!membership || !confirmedLink) {
    await audit(input.allianceId, input.discordUserId, "kills_confirm", input, noConfirm);
    return noConfirm;
  }

  const [allianceRows, commander] = await Promise.all([
    listAllianceCommanderKillsRows(input.allianceId),
    getCommanderKillsState(pending.commanderId),
  ]);
  const peerMax = peerMaxKillsExcludingCommander(
    allianceRows
      .filter((row) => row.total != null)
      .map((row) => ({ commanderId: row.commanderId, total: row.total! })),
    pending.commanderId,
  );

  const result = await runWithActivityErrors(translate, async () => {
    const processed = processKillsConfirmation({
      answer: input.answer,
      pending,
      translate,
      peerMax,
      currentTotal: commander?.currentKills ?? null,
      previousUpdatedAt: commander?.killsUpdatedAt ?? null,
      commanderName:
        membership.memberName ??
        commander?.primaryName ??
        membership.ashedMemberId ??
        pending.commanderId,
    });

    if (processed.action.type === "set_kills") {
      await upsertCommanderKills({
        commanderId: pending.commanderId,
        total: processed.action.total,
        allianceId: input.allianceId,
        ashedMemberId: membership.ashedMemberId,
        memberName:
          membership.memberName ??
          membership.ashedMemberId ??
          pending.commanderId,
        source:
          pending.kind === "ocr_confirm" ? "screenshot_ocr" : "discord",
        discordUserId: input.discordUserId,
        activity: {
          identity: { kind: "discord", discordUserId: input.discordUserId },
          method: pending.kind === "ocr_confirm" ? "screenshot" : "manual",
          pending: { expected: pending, required: true },
        },
      });
      return processed;
    }

    await saveDiscordBotPending(
      input.allianceId,
      input.discordUserId,
      processed.pending,
    );
    return processed;
  });

  await audit(input.allianceId, input.discordUserId, "kills_confirm", input, result);
  return result;
}
