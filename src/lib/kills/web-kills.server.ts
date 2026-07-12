import "server-only";

import { createDiscordTranslator } from "@/lib/discord/i18n";
import {
  isKillsConfirmPending,
  killsConfirmEventSource,
} from "@/lib/discord/bot-pending-guards.shared";
import { peerMaxKillsExcludingCommander } from "@/lib/kills/anomaly";
import {
  processKillsCommand,
  processKillsConfirmation,
  processKillsOcrResult,
} from "@/lib/kills/command";
import { validateKillsTotal } from "@/lib/kills/constants";
import type { MyKillsPostResponse } from "@/lib/kills/my-kills.shared";
import {
  countAllianceKillsReporters,
  getCommanderIdForMember,
  getCommanderKillsState,
  getHqKillsPending,
  listAllianceCommanderKillsRows,
  saveHqKillsPending,
  upsertCommanderKills,
} from "@/lib/kills/repository";
import type { KillsPendingState } from "@/lib/kills/types";
import { getHqMemberLinkForUser } from "@/lib/member-link/repository.server";

export async function handleWebKillsCommand(input: {
  allianceId: string;
  hqUserId: string;
  locale: string;
  total?: number | null;
  confirm?: "yes" | "no" | null;
  screenshotBuffer?: Buffer | null;
}): Promise<MyKillsPostResponse | { code: "member_link_required" }> {
  const link = await getHqMemberLinkForUser(input.allianceId, input.hqUserId);
  if (!link) {
    return { code: "member_link_required" };
  }

  const commanderId = await getCommanderIdForMember(
    input.allianceId,
    link.ashedMemberId,
  );
  if (!commanderId) {
    return { code: "member_link_required" };
  }

  const translate = createDiscordTranslator(
    input.locale === "pt-BR" ? "pt-BR" : "en-US",
  );

  if (input.confirm) {
    return handleWebKillsConfirm({
      allianceId: input.allianceId,
      hqUserId: input.hqUserId,
      commanderId,
      ashedMemberId: link.ashedMemberId,
      memberName: link.memberDisplayName ?? link.ashedMemberId,
      answer: input.confirm,
      translate,
    });
  }

  let explicitTotal = input.total ?? null;
  if (input.screenshotBuffer) {
    const { parseKillsDetailsImage } = await import(
      "@/lib/kills/kill-count-ocr/parse-kills-details-image"
    );
    const ocr = await parseKillsDetailsImage(input.screenshotBuffer);
    explicitTotal = ocr.totalKills;
    if (explicitTotal == null) {
      return {
        status: "error",
        message: translate("kills.ocrFailed"),
      };
    }
  }

  if (explicitTotal != null && !validateKillsTotal(explicitTotal)) {
    return {
      status: "validation_error",
      message: translate("kills.invalidTotal"),
    };
  }

  const pending = await getHqKillsPending(input.allianceId, input.hqUserId);
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

  const commandInput = {
    explicitTotal,
    currentTotal: commander?.currentKills ?? null,
    previousUpdatedAt: commander?.killsUpdatedAt ?? null,
    commanderName: link.memberDisplayName ?? commander?.primaryName ?? link.ashedMemberId,
    commanderId,
    pending: pending as KillsPendingState | null,
    reporterCount,
    peerMax,
    translate,
  };

  const result = input.screenshotBuffer
    ? processKillsOcrResult(commandInput)
    : processKillsCommand(commandInput);

  await saveHqKillsPending(input.allianceId, input.hqUserId, result.pending);

  if (result.action.type === "set_kills") {
    await upsertCommanderKills({
      commanderId,
      total: result.action.total,
      allianceId: input.allianceId,
      ashedMemberId: link.ashedMemberId,
      memberName: link.memberDisplayName ?? link.ashedMemberId,
      source: input.screenshotBuffer ? "screenshot_ocr" : "web",
      hqUserId: input.hqUserId,
    });
    await saveHqKillsPending(input.allianceId, input.hqUserId, null);
    return {
      status: "set_kills",
      message: result.reply,
      newKills: result.action.total,
    };
  }

  if (result.needsConfirmation && result.proposedTotal != null) {
    return {
      status: input.screenshotBuffer ? "ocr_confirm" : "anomaly_confirm",
      message: result.reply,
      proposedKills: result.proposedTotal,
    };
  }

  return {
    status: "error",
    message: result.reply,
  };
}

async function handleWebKillsConfirm(input: {
  allianceId: string;
  hqUserId: string;
  commanderId: string;
  ashedMemberId: string;
  memberName: string;
  answer: "yes" | "no";
  translate: ReturnType<typeof createDiscordTranslator>;
}): Promise<MyKillsPostResponse> {
  const pending = await getHqKillsPending(input.allianceId, input.hqUserId);
  if (!isKillsConfirmPending(pending)) {
    return {
      status: "error",
      message: input.translate("errors.noConfirm"),
    };
  }

  if (pending.commanderId !== input.commanderId) {
    await saveHqKillsPending(input.allianceId, input.hqUserId, null);
    return {
      status: "error",
      message: input.translate("errors.noConfirm"),
    };
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

  const result = processKillsConfirmation({
    answer: input.answer,
    pending,
    translate: input.translate,
    peerMax,
    currentTotal: commander?.currentKills ?? null,
    previousUpdatedAt: commander?.killsUpdatedAt ?? null,
    commanderName: input.memberName,
  });
  await saveHqKillsPending(input.allianceId, input.hqUserId, result.pending);

  if (result.action.type === "set_kills") {
    await upsertCommanderKills({
      commanderId: pending.commanderId,
      total: result.action.total,
      allianceId: input.allianceId,
      ashedMemberId: input.ashedMemberId,
      memberName: input.memberName,
      source: killsConfirmEventSource(pending),
      hqUserId: input.hqUserId,
    });
    return {
      status: "set_kills",
      message: result.reply,
      newKills: result.action.total,
    };
  }

  return {
    status: input.answer === "no" ? "anomaly_rejected" : "error",
    message: result.reply,
  };
}
