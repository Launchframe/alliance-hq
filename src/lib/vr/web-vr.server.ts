import "server-only";

import { createDiscordTranslator } from "@/lib/discord/i18n";
import { resolveMaxBaseVrForAlliance } from "@/lib/game-season/game-servers.server";
import { getHqMemberLinkForUser } from "@/lib/member-link/repository.server";
import { peerMaxExcludingMember } from "@/lib/vr/anomaly";
import { processVrCommand, processVrConfirmation } from "@/lib/vr/command";
import { computeVrPercentile } from "@/lib/vr/percentile";
import type { MyVrPayload, MyVrPostResponse } from "@/lib/vr/my-vr.shared";
import { auditWebVrCommand } from "@/lib/vr/web-vr-audit.server";
import {
  countSeasonReporters,
  getHqVrPending,
  getMemberSeasonHigh,
  listMemberSeasonVrEvents,
  listSeasonVrRows,
  resolveEffectiveSeasonForVr,
  resolveSeasonKey,
  saveHqVrPending,
  upsertMemberSeasonVr,
} from "@/lib/vr/repository";
import type { VrPendingState } from "@/lib/vr/types";
import { isValidBaseVr, formatVrValidationError } from "@/lib/vr/validation";

export async function loadMyVrForUser(input: {
  allianceId: string;
  hqUserId: string;
}): Promise<MyVrPayload | null> {
  const link = await getHqMemberLinkForUser(input.allianceId, input.hqUserId);
  if (!link) {
    return null;
  }

  const { seasonKey, isPostSeason } = await resolveEffectiveSeasonForVr(
    input.allianceId,
  );
  const [currentVr, seasonRows, events] = await Promise.all([
    getMemberSeasonHigh(input.allianceId, link.ashedMemberId, seasonKey),
    listSeasonVrRows(input.allianceId, seasonKey),
    listMemberSeasonVrEvents(
      input.allianceId,
      seasonKey,
      link.ashedMemberId,
    ),
  ]);

  const reporterVrs = seasonRows.map((row) => row.highestBaseVr);
  const percentile =
    currentVr != null
      ? computeVrPercentile(reporterVrs, currentVr)
      : null;

  const seasonRow = seasonRows.find(
    (row) => row.ashedMemberId === link.ashedMemberId,
  );

  return {
    seasonKey,
    isPostSeason,
    currentVr,
    updatedAt: seasonRow?.updatedAt.toISOString() ?? null,
    commanderName: link.memberDisplayName,
    percentile,
    reporterCount: reporterVrs.length,
    events: events.map((event) => ({
      baseVr: event.baseVr,
      previousBaseVr: event.previousBaseVr,
      createdAt: event.createdAt.toISOString(),
      source: event.source,
    })),
  };
}

export async function handleWebVrCommand(input: {
  sessionId: string;
  allianceId: string;
  hqUserId: string;
  locale: string;
  explicitLevel?: number | null;
  confirm?: "yes" | "no" | null;
}): Promise<MyVrPostResponse | { code: "member_link_required" }> {
  const auditPayload = {
    explicitLevel: input.explicitLevel ?? null,
    confirm: input.confirm ?? null,
  };
  const { result, ashedMemberId } = await handleWebVrCommandCore(input);
  await auditWebVrCommand({
    sessionId: input.sessionId,
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    ashedMemberId,
    payload: auditPayload,
    result,
  });
  return result;
}

type WebVrCommandCoreOutcome = {
  result: MyVrPostResponse | { code: "member_link_required" };
  ashedMemberId: string | null;
};

async function handleWebVrCommandCore(input: {
  allianceId: string;
  hqUserId: string;
  locale: string;
  explicitLevel?: number | null;
  confirm?: "yes" | "no" | null;
}): Promise<WebVrCommandCoreOutcome> {
  const link = await getHqMemberLinkForUser(input.allianceId, input.hqUserId);
  if (!link) {
    return {
      result: { code: "member_link_required" },
      ashedMemberId: null,
    };
  }

  const translate = createDiscordTranslator(
    input.locale === "pt-BR" ? "pt-BR" : "en-US",
  );
  const seasonKey = await resolveSeasonKey(input.allianceId);

  if (input.confirm) {
    return {
      result: await handleWebVrConfirm({
        allianceId: input.allianceId,
        hqUserId: input.hqUserId,
        ashedMemberId: link.ashedMemberId,
        seasonKey,
        answer: input.confirm,
        translate,
      }),
      ashedMemberId: link.ashedMemberId,
    };
  }

  const pending = await getHqVrPending(input.allianceId, input.hqUserId);
  const [seasonHigh, reporterCount, seasonRows] = await Promise.all([
    getMemberSeasonHigh(input.allianceId, link.ashedMemberId, seasonKey),
    countSeasonReporters(input.allianceId, seasonKey),
    listSeasonVrRows(input.allianceId, seasonKey),
  ]);
  const peerMax = peerMaxExcludingMember(seasonRows, link.ashedMemberId);
  const maxBaseVr = await resolveMaxBaseVrForAlliance(input.allianceId);

  if (
    input.explicitLevel != null &&
    !isValidBaseVr(input.explicitLevel, maxBaseVr)
  ) {
    return {
      result: {
        status: "validation_error",
        message: formatVrValidationError(maxBaseVr),
      },
      ashedMemberId: link.ashedMemberId,
    };
  }

  const result = processVrCommand({
    explicitLevel: input.explicitLevel,
    seasonHigh,
    ashedMemberId: link.ashedMemberId,
    pending: pending as VrPendingState | null,
    reporterCount,
    peerMax,
    translate,
    maxBaseVr,
  });

  await saveHqVrPending(input.allianceId, input.hqUserId, result.pending);

  if (result.action.type === "set_vr") {
    await upsertMemberSeasonVr({
      allianceId: input.allianceId,
      ashedMemberId: result.action.ashedMemberId,
      seasonKey,
      baseVr: result.action.vr,
      hqUserId: input.hqUserId,
      flagReason: result.action.flagReason ?? null,
      eventSource: "web",
    });
    await saveHqVrPending(input.allianceId, input.hqUserId, null);
    return {
      result: {
        status: "set_vr",
        message: result.reply,
        newVr: result.action.vr,
      },
      ashedMemberId: link.ashedMemberId,
    };
  }

  if (result.needsConfirmation && result.proposedVr != null) {
    return {
      result: {
        status: "anomaly_confirm",
        message: result.reply,
        proposedVr: result.proposedVr,
      },
      ashedMemberId: link.ashedMemberId,
    };
  }

  return {
    result: {
      status: "error",
      message: result.reply,
    },
    ashedMemberId: link.ashedMemberId,
  };
}

async function handleWebVrConfirm(input: {
  allianceId: string;
  hqUserId: string;
  ashedMemberId: string;
  seasonKey: string;
  answer: "yes" | "no";
  translate: ReturnType<typeof createDiscordTranslator>;
}): Promise<MyVrPostResponse> {
  const pending = await getHqVrPending(input.allianceId, input.hqUserId);
  if (!pending || pending.kind !== "anomaly_confirm") {
    return {
      status: "error",
      message: input.translate("errors.noConfirm"),
    };
  }

  const result = processVrConfirmation({
    answer: input.answer,
    pending,
    translate: input.translate,
  });
  await saveHqVrPending(input.allianceId, input.hqUserId, result.pending);

  if (result.action.type === "set_vr") {
    await upsertMemberSeasonVr({
      allianceId: input.allianceId,
      ashedMemberId: result.action.ashedMemberId,
      seasonKey: input.seasonKey,
      baseVr: result.action.vr,
      hqUserId: input.hqUserId,
      flagReason: result.action.flagReason ?? null,
      eventSource: "web",
    });
    await saveHqVrPending(input.allianceId, input.hqUserId, null);
    return {
      status: "set_vr",
      message: result.reply,
      newVr: result.action.vr,
    };
  }

  return {
    status: input.answer === "no" ? "anomaly_rejected" : "error",
    message: result.reply,
  };
}
