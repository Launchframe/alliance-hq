import "server-only";

import { createDiscordTranslator } from "@/lib/discord/i18n";
import { getHqMemberLinkForUser } from "@/lib/member-link/repository.server";
import { peerMaxExcludingMember } from "@/lib/vr/anomaly";
import { processVrCommand, processVrConfirmation } from "@/lib/vr/command";
import { computeVrPercentile } from "@/lib/vr/percentile";
import type { MyVrPayload, MyVrPostResponse } from "@/lib/vr/my-vr.shared";
import { auditWebVrCommand } from "@/lib/vr/web-vr-audit.server";
import { vrSeasonLockedMessage } from "@/lib/vr/vr-season-lock.shared";
import {
  countSeasonReporters,
  getCommanderByAshedMemberId,
  getHqVrPending,
  getMemberSeasonHigh,
  listMemberSeasonVrEvents,
  listSeasonVrRows,
  resolveVrSeasonContext,
  saveHqVrPending,
  upsertMemberSeasonVr,
} from "@/lib/vr/repository";
import type { VrPendingState } from "@/lib/vr/types";
import {
  coerceInstituteLevelFromBaseVr,
  formatBaseVrValidationError,
  validateBaseVrForSeason,
} from "@/lib/vr/validation";

export async function loadMyVrForUser(input: {
  allianceId: string;
  hqUserId: string;
}): Promise<MyVrPayload | null> {
  const link = await getHqMemberLinkForUser(input.allianceId, input.hqUserId);
  if (!link) {
    return null;
  }

  const season = await resolveVrSeasonContext(input.allianceId);
  const [currentVr, seasonRows, events, commander] = await Promise.all([
    getMemberSeasonHigh(input.allianceId, link.ashedMemberId, season.seasonKey),
    listSeasonVrRows(input.allianceId, season.seasonKey),
    listMemberSeasonVrEvents(
      input.allianceId,
      season.seasonKey,
      link.ashedMemberId,
    ),
    getCommanderByAshedMemberId(link.ashedMemberId, input.allianceId),
  ]);

  const reporterVrs = seasonRows.map((row) => row.highestBaseVr);
  const percentile =
    currentVr != null
      ? computeVrPercentile(reporterVrs, currentVr)
      : null;

  const seasonRow = seasonRows.find(
    (row) => row.ashedMemberId === link.ashedMemberId,
  );

  const seasonMaxVr =
    season.vrUpdatesLocked && currentVr != null && currentVr > 0
      ? currentVr
      : null;

  const instituteLevel =
    seasonRow?.instituteLevel ??
    (currentVr != null
      ? coerceInstituteLevelFromBaseVr(season.seasonKey, currentVr)
      : null);

  return {
    seasonKey: season.seasonKey,
    isPostSeason: season.isPostSeason,
    vrUpdatesLocked: season.vrUpdatesLocked,
    vrSandboxActive: season.vrSandboxActive,
    priorSeason: season.priorSeason,
    seasonMaxVr,
    currentVr,
    instituteLevel,
    updatedAt: seasonRow?.updatedAt.toISOString() ?? null,
    commanderName: link.memberDisplayName,
    weeklyPassActive: commander?.weeklyPassActive ?? null,
    percentile,
    reporterCount: reporterVrs.length,
    events: events.map((event) => ({
      baseVr: event.baseVr,
      instituteLevel:
        event.instituteLevel ??
        coerceInstituteLevelFromBaseVr(season.seasonKey, event.baseVr),
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
  const season = await resolveVrSeasonContext(input.allianceId);

  if (season.vrUpdatesLocked) {
    return {
      result: {
        status: "season_locked",
        message: vrSeasonLockedMessage(translate),
      },
      ashedMemberId: link.ashedMemberId,
    };
  }

  if (input.confirm) {
    return {
      result: await handleWebVrConfirm({
        allianceId: input.allianceId,
        hqUserId: input.hqUserId,
        ashedMemberId: link.ashedMemberId,
        seasonKey: season.seasonKey,
        answer: input.confirm,
        translate,
      }),
      ashedMemberId: link.ashedMemberId,
    };
  }

  const pending = await getHqVrPending(input.allianceId, input.hqUserId);
  const [seasonHigh, reporterCount, seasonRows] = await Promise.all([
    getMemberSeasonHigh(input.allianceId, link.ashedMemberId, season.seasonKey),
    countSeasonReporters(input.allianceId, season.seasonKey),
    listSeasonVrRows(input.allianceId, season.seasonKey),
  ]);
  const peerMax = peerMaxExcludingMember(seasonRows, link.ashedMemberId);

  if (input.explicitLevel != null) {
    const validated = validateBaseVrForSeason(
      season.seasonKey,
      input.explicitLevel,
    );
    if (!validated.ok) {
      return {
        result: {
          status: "validation_error",
          message: formatBaseVrValidationError(validated),
        },
        ashedMemberId: link.ashedMemberId,
      };
    }
  }

  const result = processVrCommand({
    explicitLevel: input.explicitLevel,
    seasonHigh,
    ashedMemberId: link.ashedMemberId,
    pending: pending as VrPendingState | null,
    reporterCount,
    peerMax,
    translate,
    seasonKey: season.seasonKey,
  });

  await saveHqVrPending(input.allianceId, input.hqUserId, result.pending);

  if (result.action.type === "set_vr") {
    await upsertMemberSeasonVr({
      allianceId: input.allianceId,
      ashedMemberId: result.action.ashedMemberId,
      seasonKey: season.seasonKey,
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
  const season = await resolveVrSeasonContext(input.allianceId);
  if (season.vrUpdatesLocked) {
    return {
      status: "season_locked",
      message: vrSeasonLockedMessage(input.translate),
    };
  }

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
