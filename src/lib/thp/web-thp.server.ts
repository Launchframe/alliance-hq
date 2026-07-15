import "server-only";

import { createDiscordTranslator } from "@/lib/discord/i18n";
import { isThpConfirmPending } from "@/lib/discord/bot-pending-guards.shared";
import { getHqMemberLinkForUser } from "@/lib/member-link/repository.server";
import {
  validateThpTotal,
} from "@/lib/thp/breakdown.shared";
import { peerMaxThpExcludingCommander } from "@/lib/thp/anomaly";
import {
  processThpCommand,
  processThpConfirmation,
  processThpOcrResult,
} from "@/lib/thp/command";
import { toThpBreakdown } from "@/lib/thp/hero-power-ocr/parse-power-details";
import type { MyThpPostResponse, ThpBreakdown } from "@/lib/thp/my-thp.shared";
import {
  countAllianceThpReporters,
  getCommanderIdForMember,
  getCommanderThpState,
  getHqThpPending,
  listAllianceCommanderThpRows,
  saveHqThpPending,
  upsertCommanderThp,
} from "@/lib/thp/repository";
import type { ThpPendingState } from "@/lib/thp/types";

export async function handleWebThpCommand(input: {
  allianceId: string;
  hqUserId: string;
  locale: string;
  total?: number | null;
  breakdown?: ThpBreakdown | null;
  confirm?: "yes" | "no" | null;
  screenshotBuffer?: Buffer | null;
}): Promise<MyThpPostResponse | { code: "member_link_required" }> {
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
    return handleWebThpConfirm({
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
  let explicitBreakdown = input.breakdown ?? null;

  if (input.screenshotBuffer) {
    const { parsePowerDetailsImage } = await import(
      "@/lib/thp/hero-power-ocr/parse-power-details-image"
    );
    const ocr = await parsePowerDetailsImage(input.screenshotBuffer);
    explicitBreakdown = ocr.complete ? toThpBreakdown(ocr.breakdown) : null;
    explicitTotal = ocr.heroPowerTotal;
    if (explicitTotal == null && explicitBreakdown) {
      explicitTotal = Object.values(explicitBreakdown).reduce((a, b) => a + b, 0);
    }
    if (explicitTotal == null || !validateThpTotal(explicitTotal)) {
      const partialValues = Object.entries(ocr.breakdown).filter(
        ([, v]) => v != null && v > 0,
      );
      if (partialValues.length > 0) {
        return {
          status: "ocr_partial",
          message: translate("thp.ocrPartial"),
          partialBreakdown: ocr.breakdown,
        };
      }
      if (explicitTotal == null) {
        return {
          status: "error",
          message: translate("thp.ocrFailed"),
        };
      }
    }
  }

  if (explicitTotal != null && !validateThpTotal(explicitTotal)) {
    return {
      status: "validation_error",
      message: translate("thp.invalidTotal"),
    };
  }

  const pending = await getHqThpPending(input.allianceId, input.hqUserId);
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
    commanderName: link.memberDisplayName ?? commander?.primaryName ?? link.ashedMemberId,
    commanderId,
    pending: pending as ThpPendingState | null,
    reporterCount,
    peerMax,
    translate,
  };

  const result = input.screenshotBuffer
    ? processThpOcrResult(commandInput)
    : processThpCommand(commandInput);

  await saveHqThpPending(input.allianceId, input.hqUserId, result.pending);

  if (result.action.type === "set_thp") {
    await upsertCommanderThp({
      commanderId,
      total: result.action.total,
      breakdown: result.action.breakdown,
      allianceId: input.allianceId,
      ashedMemberId: link.ashedMemberId,
      memberName: link.memberDisplayName ?? link.ashedMemberId,
      source: input.screenshotBuffer ? "screenshot_ocr" : "web",
      hqUserId: input.hqUserId,
    });
    await saveHqThpPending(input.allianceId, input.hqUserId, null);
    return {
      status: "set_thp",
      message: result.reply,
      newThp: result.action.total,
    };
  }

  if (result.needsConfirmation && result.proposedTotal != null) {
    return {
      status: input.screenshotBuffer ? "ocr_confirm" : "anomaly_confirm",
      message: result.reply,
      proposedThp: result.proposedTotal,
      proposedBreakdown: result.proposedBreakdown ?? null,
    };
  }

  return {
    status: "error",
    message: result.reply,
  };
}

async function handleWebThpConfirm(input: {
  allianceId: string;
  hqUserId: string;
  commanderId: string;
  ashedMemberId: string;
  memberName: string;
  answer: "yes" | "no";
  translate: ReturnType<typeof createDiscordTranslator>;
}): Promise<MyThpPostResponse> {
  const pending = await getHqThpPending(input.allianceId, input.hqUserId);
  if (!isThpConfirmPending(pending)) {
    return {
      status: "error",
      message: input.translate("errors.noConfirm"),
    };
  }

  if (pending.commanderId !== input.commanderId) {
    await saveHqThpPending(input.allianceId, input.hqUserId, null);
    return {
      status: "error",
      message: input.translate("errors.noConfirm"),
    };
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

  const result = processThpConfirmation({
    answer: input.answer,
    pending,
    translate: input.translate,
    peerMax,
    currentTotal: commander?.currentTotalHeroPower ?? null,
    previousUpdatedAt: commander?.thpUpdatedAt ?? null,
    commanderName: input.memberName,
  });
  await saveHqThpPending(input.allianceId, input.hqUserId, result.pending);

  if (result.action.type === "set_thp") {
    await upsertCommanderThp({
      commanderId: pending.commanderId,
      total: result.action.total,
      breakdown: result.action.breakdown,
      allianceId: input.allianceId,
      ashedMemberId: input.ashedMemberId,
      memberName: input.memberName,
      source: pending.kind === "ocr_confirm" ? "screenshot_ocr" : "web",
      hqUserId: input.hqUserId,
    });
    return {
      status: "set_thp",
      message: result.reply,
      newThp: result.action.total,
    };
  }

  return {
    status: input.answer === "no" ? "anomaly_rejected" : "error",
    message: result.reply,
  };
}
