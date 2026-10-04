import "server-only";

import { ActivityWriteError } from "@/lib/activity/errors.server";
import type { DiscordBotLocale, DiscordTranslate } from "@/lib/discord/i18n";
import { createDiscordTranslator } from "@/lib/discord/i18n";
import { isThpConfirmPending, thpConfirmEventSource } from "@/lib/discord/bot-pending-guards.shared";
import { ensureDiscordMemberLinksFromHq } from "@/lib/member-link/inherit-hq-to-discord.server";
import { peerMaxThpExcludingCommander } from "@/lib/thp/anomaly";
import {
  processThpCommand,
  processThpConfirmation,
  processThpOcrResult,
} from "@/lib/thp/command";
import { toThpBreakdown } from "@/lib/thp/hero-power-ocr/parse-power-details";
import {
  countAllianceThpReporters,
  getCommanderIdForMember,
  getCommanderMembershipInAlliance,
  getCommanderThpState,
  listAllianceCommanderThpRows,
  ThpPendingChangedError,
  upsertCommanderThp,
} from "@/lib/thp/repository";
import type { ThpCommandResult, ThpPendingState } from "@/lib/thp/types";
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
  work: () => Promise<ThpCommandResult>,
): Promise<ThpCommandResult> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ThpPendingChangedError) {
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
    console.error("[discord-bot] thp audit log failed", error);
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

async function runThpForLink(input: {
  allianceId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
  ashedMemberId: string;
  memberDisplayName: string | null;
  explicitTotal?: number | null;
  screenshotBuffer?: Buffer | null;
}): Promise<ThpCommandResult> {
  const { translate } = botContext(input.locale);
  const commanderId = await getCommanderIdForMember(
    input.allianceId,
    input.ashedMemberId,
  );
  if (!commanderId) {
    return {
      reply: translate("thp.commanderNotFound"),
      pending: null,
      action: { type: "none" },
    };
  }

  let explicitTotal = input.explicitTotal ?? null;
  let explicitBreakdown = null;
  if (input.screenshotBuffer) {
    const { parsePowerDetailsImage } = await import(
      "@/lib/thp/hero-power-ocr/parse-power-details-image"
    );
    const ocr = await parsePowerDetailsImage(input.screenshotBuffer);
    // Only trust a full breakdown when rows reconcile to the Hero Power header.
    // Unreconciled rows must not feed resolveProposed (it prefers breakdown sum).
    explicitBreakdown = ocr.complete ? toThpBreakdown(ocr.breakdown) : null;
    explicitTotal = ocr.heroPowerTotal;
    if (explicitTotal == null && explicitBreakdown) {
      explicitTotal = Object.values(explicitBreakdown).reduce((a, b) => a + b, 0);
    }
    if (explicitTotal == null) {
      return {
        reply: translate("thp.ocrFailed"),
        pending: null,
        action: { type: "none" },
      };
    }
  }

  const pendingRow = await getDiscordBotPending(input.discordUserId);
  const pending = (
    pendingRow && pendingRow.allianceId === input.allianceId
      ? pendingRow.pending
      : null
  ) as ThpPendingState | null;
  const commander = await getCommanderThpState(commanderId);
  const [reporterCount, allianceRows] = await Promise.all([
    countAllianceThpReporters(input.allianceId),
    listAllianceCommanderThpRows(input.allianceId),
  ]);
  const peerMax = peerMaxThpExcludingCommander(
    allianceRows
      .filter((row) => row.total != null)
      .map((row) => ({ commanderId: row.commanderId, total: row.total! })),
    commanderId,
  );

  const commandInput = {
    explicitTotal,
    explicitBreakdown,
    currentTotal: commander?.currentTotalHeroPower ?? null,
    previousUpdatedAt: commander?.thpUpdatedAt ?? null,
    commanderName:
      input.memberDisplayName ?? commander?.primaryName ?? input.ashedMemberId,
    commanderId,
    pending,
    reporterCount,
    peerMax,
    translate,
  };

  const result = input.screenshotBuffer
    ? processThpOcrResult(commandInput)
    : processThpCommand(commandInput);

  if (result.action.type === "set_thp") {
    await upsertCommanderThp({
      commanderId,
      total: result.action.total,
      breakdown: result.action.breakdown,
      allianceId: input.allianceId,
      ashedMemberId: input.ashedMemberId,
      memberName: input.memberDisplayName ?? input.ashedMemberId,
      source: input.screenshotBuffer ? "screenshot_ocr" : "discord",
      discordUserId: input.discordUserId,
      activity: {
        identity: { kind: "discord", discordUserId: input.discordUserId },
        method: input.screenshotBuffer ? "screenshot" : "manual",
        ...(pending
          ? { pending: { expected: pending, required: false } }
          : {}),
      },
    });
    return result;
  }

  await saveDiscordBotPending(input.allianceId, input.discordUserId, result.pending);
  return result;
}

export async function handleDiscordThpSlash(input: {
  allianceId: string;
  discordUserId: string;
  explicitTotal?: number | null;
  screenshotBuffer?: Buffer | null;
  linkId?: string | null;
  locale: DiscordBotLocale;
}): Promise<ThpCommandResult> {
  const { translate } = botContext(input.locale);
  const target = await resolveTargetLink(input);
  if (target === null) {
    const result: ThpCommandResult = {
      reply: translate("thp.notLinked"),
      pending: null,
      action: { type: "none" },
    };
    await audit(input.allianceId, input.discordUserId, "thp", input, result);
    return result;
  }
  if (target === "pick") {
    const links = await listDiscordLinksForUser(input.allianceId, input.discordUserId, {
      rematerializeFormer: true,
    });
    const result: ThpCommandResult = {
      reply: translate("thp.pickCharacter"),
      pending: { kind: "pick_character", linkIds: links.map((l) => l.id) },
      action: { type: "none" },
      characterPicker: links.map((l) => ({
        linkId: l.id,
        label: l.memberDisplayName ?? l.ashedMemberId,
      })),
    };
    await saveDiscordBotPending(input.allianceId, input.discordUserId, result.pending);
    await audit(input.allianceId, input.discordUserId, "thp", input, result);
    return result;
  }

  const result = await runWithActivityErrors(translate, () =>
    runThpForLink({
      allianceId: input.allianceId,
      discordUserId: input.discordUserId,
      locale: input.locale,
      ashedMemberId: target.ashedMemberId,
      memberDisplayName: target.memberDisplayName,
      explicitTotal: input.explicitTotal,
      screenshotBuffer: input.screenshotBuffer,
    }),
  );
  await audit(input.allianceId, input.discordUserId, "thp", input, result);
  return result;
}

export async function handleDiscordThpCharacterPick(input: {
  allianceId: string;
  discordUserId: string;
  linkId: string;
  locale: DiscordBotLocale;
}): Promise<ThpCommandResult> {
  const { translate } = botContext(input.locale);
  const link = await getDiscordLinkById(input.linkId);
  if (
    !link ||
    link.discordUserId !== input.discordUserId ||
    link.allianceId !== input.allianceId
  ) {
    const result: ThpCommandResult = {
      reply: translate("errors.nothingPending"),
      pending: null,
      action: { type: "none" },
    };
    await audit(input.allianceId, input.discordUserId, "thp_character", input, result);
    return result;
  }

  const result = await runWithActivityErrors(translate, () =>
    runThpForLink({
      allianceId: input.allianceId,
      discordUserId: input.discordUserId,
      locale: input.locale,
      ashedMemberId: link.ashedMemberId,
      memberDisplayName: link.memberDisplayName,
    }),
  );
  await audit(input.allianceId, input.discordUserId, "thp_character", input, result);
  return result;
}

export async function handleDiscordThpButtonConfirm(input: {
  allianceId: string;
  discordUserId: string;
  answer: "yes" | "no";
  locale: DiscordBotLocale;
}): Promise<ThpCommandResult> {
  const { translate } = botContext(input.locale);
  const noConfirm: ThpCommandResult = {
    reply: translate("errors.noConfirm"),
    pending: null,
    action: { type: "none" },
  };
  const pendingRow = await getDiscordBotPending(input.discordUserId);
  const pending =
    pendingRow && pendingRow.allianceId === input.allianceId
      ? pendingRow.pending
      : null;
  if (!isThpConfirmPending(pending)) {
    await audit(input.allianceId, input.discordUserId, "thp_confirm", input, noConfirm);
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
    await audit(input.allianceId, input.discordUserId, "thp_confirm", input, noConfirm);
    return noConfirm;
  }

  const [allianceRows, commander] = await Promise.all([
    listAllianceCommanderThpRows(input.allianceId),
    getCommanderThpState(pending.commanderId),
  ]);
  const peerMax = peerMaxThpExcludingCommander(
    allianceRows
      .filter((row) => row.total != null)
      .map((row) => ({ commanderId: row.commanderId, total: row.total! })),
    pending.commanderId,
  );

  const result = await runWithActivityErrors(translate, async () => {
    const processed = processThpConfirmation({
      answer: input.answer,
      pending,
      translate,
      peerMax,
      currentTotal: commander?.currentTotalHeroPower ?? null,
      previousUpdatedAt: commander?.thpUpdatedAt ?? null,
      commanderName:
        membership.memberName ??
        commander?.primaryName ??
        membership.ashedMemberId ??
        pending.commanderId,
    });

    if (processed.action.type === "set_thp") {
      await upsertCommanderThp({
        commanderId: pending.commanderId,
        total: processed.action.total,
        breakdown: processed.action.breakdown,
        allianceId: input.allianceId,
        ashedMemberId: membership.ashedMemberId,
        memberName:
          membership.memberName ??
          membership.ashedMemberId ??
          pending.commanderId,
        source: thpConfirmEventSource(pending),
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

  await audit(input.allianceId, input.discordUserId, "thp_confirm", input, result);
  return result;
}
