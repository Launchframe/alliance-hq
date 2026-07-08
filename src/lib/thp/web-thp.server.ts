import "server-only";

import { createDiscordTranslator } from "@/lib/discord/i18n";
import { getHqMemberLinkForUser } from "@/lib/member-link/repository.server";
import {
  parseThpBreakdownInput,
  validateThpTotal,
} from "@/lib/thp/breakdown.shared";
import { peerMaxThpExcludingCommander } from "@/lib/thp/anomaly";
import { processThpCommand, processThpConfirmation, processThpOcrResult } from "@/lib/thp/command";
import {
  parsePowerDetailsImage,
  toThpBreakdown,
} from "@/lib/thp/hero-power-ocr/parse-power-details-image";
import type { MyThpPayload, MyThpPostResponse, ThpBreakdown } from "@/lib/thp/my-thp.shared";
import { computeThpPercentileChange } from "@/lib/thp/percentile-change";
import { computeThpPercentile } from "@/lib/thp/percentile";
import {
  countAllianceThpReporters,
  getCommanderIdForMember,
  getCommanderThpState,
  getHqThpPending,
  listAllianceCommanderThpEvents,
  listAllianceCommanderThpRows,
  listCommanderThpEvents,
  saveHqThpPending,
  upsertCommanderThp,
} from "@/lib/thp/repository";
import type { ThpPendingState } from "@/lib/thp/types";

function mapBreakdown(value: unknown): ThpBreakdown | null {
  return parseThpBreakdownInput(value);
}

export async function loadMyThpForUser(input: {
  allianceId: string;
  hqUserId: string;
}): Promise<MyThpPayload | null> {
  const link = await getHqMemberLinkForUser(input.allianceId, input.hqUserId);
  if (!link) return null;

  const commanderId = await getCommanderIdForMember(
    input.allianceId,
    link.ashedMemberId,
  );
  if (!commanderId) return null;

  const [commander, events, allianceRows, allianceEventsByCommander] =
    await Promise.all([
      getCommanderThpState(commanderId),
      listCommanderThpEvents(commanderId),
      listAllianceCommanderThpRows(input.allianceId),
      listAllianceCommanderThpEvents(input.allianceId),
    ]);

  const reporterThps = allianceRows
    .map((row) => row.total)
    .filter((total): total is number => total != null);
  const currentThp = commander?.currentTotalHeroPower ?? null;
  const percentile =
    currentThp != null ? computeThpPercentile(reporterThps, currentThp) : null;

  const viewerSnapshots = events.map((event) => ({
    commanderId,
    total: event.total,
    recordedAt: event.createdAt,
  }));
  const allianceSnapshots = new Map(
    [...allianceEventsByCommander.entries()].map(([id, rows]) => [
      id,
      rows.map((row) => ({
        commanderId: row.commanderId,
        total: row.total,
        recordedAt: row.createdAt,
      })),
    ]),
  );

  return {
    currentThp,
    breakdown: mapBreakdown(commander?.currentThpBreakdown),
    updatedAt: commander?.thpUpdatedAt?.toISOString() ?? null,
    commanderName: commander?.primaryName ?? link.memberDisplayName,
    percentile,
    percentileChange: computeThpPercentileChange({
      viewerCommanderId: commanderId,
      viewerEvents: viewerSnapshots,
      allianceEventsByCommander: allianceSnapshots,
    }),
    reporterCount: reporterThps.length,
    events: events.map((event) => ({
      total: event.total,
      breakdown: mapBreakdown(event.breakdown),
      previousTotal: event.previousTotal,
      createdAt: event.createdAt.toISOString(),
      source: event.source,
    })),
  };
}

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
    const ocr = await parsePowerDetailsImage(input.screenshotBuffer);
    explicitBreakdown = toThpBreakdown(ocr.breakdown);
    explicitTotal = ocr.heroPowerTotal;
    if (explicitTotal == null && explicitBreakdown) {
      explicitTotal = Object.values(explicitBreakdown).reduce((a, b) => a + b, 0);
    }
    if (explicitTotal == null) {
      return {
        status: "error",
        message: translate("thp.ocrFailed"),
      };
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
  if (
    !pending ||
    (pending.kind !== "anomaly_confirm" && pending.kind !== "ocr_confirm")
  ) {
    return {
      status: "error",
      message: input.translate("errors.noConfirm"),
    };
  }

  const allianceRows = await listAllianceCommanderThpRows(input.allianceId);
  const peerMax = peerMaxThpExcludingCommander(
    allianceRows
      .filter((row) => row.total != null)
      .map((row) => ({ commanderId: row.commanderId, total: row.total! })),
    input.commanderId,
  );

  const result = processThpConfirmation({
    answer: input.answer,
    pending,
    translate: input.translate,
    peerMax,
  });
  await saveHqThpPending(input.allianceId, input.hqUserId, result.pending);

  if (result.action.type === "set_thp") {
    await upsertCommanderThp({
      commanderId: input.commanderId,
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
