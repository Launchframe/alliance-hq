import type { DiscordTranslate } from "@/lib/discord/i18n";
import { shouldAnomalyConfirm } from "@/lib/vr/anomaly";
import type { VrCommandResult, VrPendingState } from "@/lib/vr/types";
import {
  formatVrValidationError,
  initialBaseVrForBump,
  isValidBaseVr,
  maxAllowedDowngrade,
  nextBaseVr,
} from "@/lib/vr/validation";

export type ProcessVrCommandInput = {
  explicitLevel?: number | null;
  seasonHigh: number | null;
  ashedMemberId: string;
  pending: VrPendingState | null;
  reporterCount: number;
  peerMax: number;
  translate: DiscordTranslate;
  maxBaseVr: number;
};

export type ProcessVrConfirmationInput = {
  answer: "yes" | "no";
  pending: VrPendingState;
  translate: DiscordTranslate;
};

function applyExplicitLevel(
  value: number,
  input: ProcessVrCommandInput,
): VrCommandResult {
  const { translate: t } = input;
  const seasonHigh = input.seasonHigh ?? 0;
  if (value < maxAllowedDowngrade(seasonHigh)) {
    return {
      reply: t("vr.downgradeLimit", { seasonHigh }),
      pending: null,
      action: { type: "none" },
    };
  }

  if (
    shouldAnomalyConfirm({
      proposedVr: value,
      reporterCount: input.reporterCount,
      peerMax: input.peerMax,
    })
  ) {
    return {
      reply: t("vr.anomalyConfirm", { vr: value }),
      pending: {
        kind: "anomaly_confirm",
        proposedVr: value,
        ashedMemberId: input.ashedMemberId,
      },
      action: { type: "none" },
      needsConfirmation: true,
      proposedVr: value,
    };
  }

  return {
    reply: t("vr.success", { vr: value }),
    pending: null,
    action: {
      type: "set_vr",
      vr: value,
      ashedMemberId: input.ashedMemberId,
    },
  };
}

export function processVrCommand(input: ProcessVrCommandInput): VrCommandResult {
  const { explicitLevel, seasonHigh, pending, translate: t, maxBaseVr } = input;

  if (pending?.kind === "anomaly_confirm" && explicitLevel == null) {
    return {
      reply: t("vr.stillWaiting", { vr: pending.proposedVr }),
      pending,
      action: { type: "none" },
      needsConfirmation: true,
      proposedVr: pending.proposedVr,
    };
  }

  if (explicitLevel != null) {
    if (!isValidBaseVr(explicitLevel, maxBaseVr)) {
      return {
        reply: formatVrValidationError(maxBaseVr),
        pending,
        action: { type: "none" },
      };
    }
    return applyExplicitLevel(explicitLevel, input);
  }

  const current = seasonHigh ?? 0;
  const next =
    current <= 0 ? initialBaseVrForBump() : nextBaseVr(current);
  if (!isValidBaseVr(next, maxBaseVr)) {
    return {
      reply: t("vr.maxVr", { max: maxBaseVr }),
      pending: null,
      action: { type: "none" },
    };
  }

  return applyExplicitLevel(next, {
    ...input,
    explicitLevel: next,
  });
}

export function processVrConfirmation(
  input: ProcessVrConfirmationInput,
): VrCommandResult {
  const { answer, pending, translate: t } = input;
  if (pending.kind !== "anomaly_confirm") {
    return {
      reply: t("errors.noConfirm"),
      pending: null,
      action: { type: "none" },
    };
  }

  if (answer === "no") {
    return {
      reply: t("vr.declined"),
      pending: null,
      action: { type: "none" },
    };
  }

  return {
    reply: t("vr.success", { vr: pending.proposedVr }),
    pending: null,
    action: {
      type: "set_vr",
      vr: pending.proposedVr,
      ashedMemberId: pending.ashedMemberId,
      flagReason: "anomaly_confirmed",
    },
  };
}
