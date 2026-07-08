import type { DiscordBotLocale } from "@/lib/discord/i18n";
import { createDiscordTranslator } from "@/lib/discord/i18n";
import { ensureDiscordMemberLinksFromHq } from "@/lib/member-link/inherit-hq-to-discord.server";
import { peerMaxThpExcludingCommander } from "@/lib/thp/anomaly";
import {
  processThpCommand,
  processThpConfirmation,
  processThpOcrResult,
} from "@/lib/thp/command";
import {
  parsePowerDetailsImage,
  toThpBreakdown,
} from "@/lib/thp/hero-power-ocr/parse-power-details-image";
import {
  countAllianceThpReporters,
  getCommanderIdForMember,
  getCommanderMembershipInAlliance,
  getCommanderThpState,
  listAllianceCommanderThpRows,
  upsertCommanderThp,
} from "@/lib/thp/repository";
import type { ThpCommandResult, ThpPendingState } from "@/lib/thp/types";
import type { LinkPendingState, VrPendingState } from "@/lib/vr/types";
import {
  getDiscordBotPending,
  getDiscordLinkById,
  listDiscordLinksForUser,
  saveDiscordBotPending,
  writeDiscordBotAudit,
} from "@/lib/vr/repository";

function asDiscordPending(pending: ThpPendingState | null) {
  return pending as unknown as VrPendingState | LinkPendingState | null;
}

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
    const ocr = await parsePowerDetailsImage(input.screenshotBuffer);
    explicitBreakdown = toThpBreakdown(ocr.breakdown);
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
  const pending = (pendingRow?.pending ?? null) as ThpPendingState | null;
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
    commanderId,
    pending,
    reporterCount,
    peerMax,
    translate,
  };

  const result = input.screenshotBuffer
    ? processThpOcrResult(commandInput)
    : processThpCommand(commandInput);

  await saveDiscordBotPending(input.allianceId, input.discordUserId, asDiscordPending(result.pending));

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
    });
    await saveDiscordBotPending(input.allianceId, input.discordUserId, null);
  }

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
    const links = await listDiscordLinksForUser(input.allianceId, input.discordUserId);
    const result: ThpCommandResult = {
      reply: translate("thp.pickCharacter"),
      pending: { kind: "pick_character", linkIds: links.map((l) => l.id) },
      action: { type: "none" },
      characterPicker: links.map((l) => ({
        linkId: l.id,
        label: l.memberDisplayName ?? l.ashedMemberId,
      })),
    };
    await saveDiscordBotPending(input.allianceId, input.discordUserId, asDiscordPending(result.pending));
    await audit(input.allianceId, input.discordUserId, "thp", input, result);
    return result;
  }

  const result = await runThpForLink({
    allianceId: input.allianceId,
    discordUserId: input.discordUserId,
    locale: input.locale,
    ashedMemberId: target.ashedMemberId,
    memberDisplayName: target.memberDisplayName,
    explicitTotal: input.explicitTotal,
    screenshotBuffer: input.screenshotBuffer,
  });
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
  if (!link || link.discordUserId !== input.discordUserId) {
    const result: ThpCommandResult = {
      reply: translate("errors.nothingPending"),
      pending: null,
      action: { type: "none" },
    };
    await audit(input.allianceId, input.discordUserId, "thp_character", input, result);
    return result;
  }

  const result = await runThpForLink({
    allianceId: input.allianceId,
    discordUserId: input.discordUserId,
    locale: input.locale,
    ashedMemberId: link.ashedMemberId,
    memberDisplayName: link.memberDisplayName,
  });
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
  const pendingRow = await getDiscordBotPending(input.discordUserId);
  const pending = pendingRow?.pending as ThpPendingState | null;
  if (
    !pending ||
    (pending.kind !== "anomaly_confirm" && pending.kind !== "ocr_confirm")
  ) {
    const result: ThpCommandResult = {
      reply: translate("errors.noConfirm"),
      pending: null,
      action: { type: "none" },
    };
    await audit(input.allianceId, input.discordUserId, "thp_confirm", input, result);
    return result;
  }

  const allianceRows = await listAllianceCommanderThpRows(input.allianceId);
  const peerMax = peerMaxThpExcludingCommander(
    allianceRows
      .filter((row) => row.total != null)
      .map((row) => ({ commanderId: row.commanderId, total: row.total! })),
    pending.commanderId,
  );

  const result = processThpConfirmation({
    answer: input.answer,
    pending,
    translate,
    peerMax,
  });
  await saveDiscordBotPending(input.allianceId, input.discordUserId, asDiscordPending(result.pending));

  if (result.action.type === "set_thp") {
    const membership = await getCommanderMembershipInAlliance(
      pending.commanderId,
      input.allianceId,
    );
    await upsertCommanderThp({
      commanderId: pending.commanderId,
      total: result.action.total,
      breakdown: result.action.breakdown,
      allianceId: input.allianceId,
      ashedMemberId: membership?.ashedMemberId,
      memberName: membership?.ashedMemberId,
      source: pending.kind === "ocr_confirm" ? "screenshot_ocr" : "discord",
      discordUserId: input.discordUserId,
    });
    await saveDiscordBotPending(input.allianceId, input.discordUserId, null);
  }

  await audit(input.allianceId, input.discordUserId, "thp_confirm", input, result);
  return result;
}
