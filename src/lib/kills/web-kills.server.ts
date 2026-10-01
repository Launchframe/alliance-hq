import "server-only";

import type { ActivityPrincipal } from "@/lib/activity/access.server";
import { ActivityWriteError } from "@/lib/activity/errors.server";
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
  KillsPendingChangedError,
  listAllianceCommanderKillsRows,
  saveHqKillsPending,
  upsertCommanderKills,
} from "@/lib/kills/repository";
import type { KillsPendingState } from "@/lib/kills/types";
import { getHqMemberLinkForUser } from "@/lib/member-link/repository.server";

type WebKillsCommandInput = {
  allianceId: string;
  hqUserId: string;
  principal: ActivityPrincipal;
  locale: string;
  total?: number | null;
  confirm?: "yes" | "no" | null;
  screenshotBuffer?: Buffer | null;
};

export async function handleWebKillsCommand(
  input: WebKillsCommandInput,
): Promise<MyKillsPostResponse | { code: "member_link_required" }> {
  const translate = createDiscordTranslator(
    input.locale === "pt-BR" ? "pt-BR" : "en-US",
  );
  try {
    return await executeWebKillsCommand(input);
  } catch (error) {
    if (error instanceof KillsPendingChangedError) {
      return { status: "error", message: translate("errors.noConfirm") };
    }
    if (error instanceof ActivityWriteError) {
      return {
        status: "error",
        message: translate("activity.saveBlocked"),
      };
    }
    throw error;
  }
}

async function executeWebKillsCommand(
  input: WebKillsCommandInput,
): Promise<MyKillsPostResponse | { code: "member_link_required" }> {
  if (
    input.principal.hqUserId !== input.hqUserId ||
    input.principal.currentAllianceId !== input.allianceId
  ) {
    return { code: "member_link_required" };
  }
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
      principal: input.principal,
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

  if (result.action.type === "set_kills") {
    await upsertCommanderKills({
      commanderId,
      total: result.action.total,
      allianceId: input.allianceId,
      ashedMemberId: link.ashedMemberId,
      memberName: link.memberDisplayName ?? link.ashedMemberId,
      source: input.screenshotBuffer ? "screenshot_ocr" : "web",
      hqUserId: input.hqUserId,
      activity: {
        identity: { kind: "web", principal: input.principal },
        method: input.screenshotBuffer ? "screenshot" : "manual",
        ...(pending
          ? { pending: { expected: pending, required: false } }
          : {}),
      },
    });
    return {
      status: "set_kills",
      message: result.reply,
      newKills: result.action.total,
    };
  }

  await saveHqKillsPending(input.allianceId, input.hqUserId, result.pending);

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
  principal: ActivityPrincipal;
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

  if (result.action.type === "set_kills") {
    await upsertCommanderKills({
      commanderId: pending.commanderId,
      total: result.action.total,
      allianceId: input.allianceId,
      ashedMemberId: input.ashedMemberId,
      memberName: input.memberName,
      source: killsConfirmEventSource(pending),
      hqUserId: input.hqUserId,
      activity: {
        identity: { kind: "web", principal: input.principal },
        method: pending.kind === "ocr_confirm" ? "screenshot" : "manual",
        pending: { expected: pending, required: true },
      },
    });
    return {
      status: "set_kills",
      message: result.reply,
      newKills: result.action.total,
    };
  }

  await saveHqKillsPending(input.allianceId, input.hqUserId, result.pending);

  return {
    status: input.answer === "no" ? "anomaly_rejected" : "error",
    message: result.reply,
  };
}
