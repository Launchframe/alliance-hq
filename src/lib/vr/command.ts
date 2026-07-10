import type { DiscordTranslate } from "@/lib/discord/i18n";
import { shouldAnomalyConfirm } from "@/lib/vr/anomaly";
import type { VrCommandResult, VrPendingState } from "@/lib/vr/types";
import {
  formatBaseVrValidationError,
  initialBaseVrForBump,
  instituteLevelForBaseVr,
  maxAllowedDowngradeForSeason,
  maxInstituteLevel,
  nextBaseVrForSeason,
  validateBaseVrForSeason,
} from "@/lib/vr/validation";

export type ProcessVrCommandInput = {
  explicitLevel?: number | null;
  seasonHigh: number | null;
  ashedMemberId: string;
  commanderId?: string | null;
  pending: VrPendingState | null;
  reporterCount: number;
  peerMax: number;
  translate: DiscordTranslate;
  seasonKey: string;
};

export type ProcessVrConfirmationInput = {
  answer: "yes" | "no";
  pending: VrPendingState;
  translate: DiscordTranslate;
  seasonKey: string;
};

function instituteLevelLabel(seasonKey: string, baseVr: number): number | string {
  return instituteLevelForBaseVr(seasonKey, baseVr) ?? "?";
}

function applyExplicitLevel(
  value: number,
  input: ProcessVrCommandInput,
): VrCommandResult {
  const { translate: t, seasonKey } = input;
  const seasonHigh = input.seasonHigh ?? 0;
  if (value < maxAllowedDowngradeForSeason(seasonKey, seasonHigh)) {
    return {
      reply: t("vr.downgradeLimit", { seasonHigh }),
      pending: null,
      action: { type: "none" },
    };
  }

  const level = instituteLevelLabel(seasonKey, value);

  if (
    shouldAnomalyConfirm({
      proposedVr: value,
      reporterCount: input.reporterCount,
      peerMax: input.peerMax,
    })
  ) {
    return {
      reply: t("vr.anomalyConfirm", { level, vr: value }),
      pending: {
        kind: "anomaly_confirm",
        proposedVr: value,
        ashedMemberId: input.ashedMemberId,
        ...(input.commanderId ? { commanderId: input.commanderId } : {}),
      },
      action: { type: "none" },
      needsConfirmation: true,
      proposedVr: value,
    };
  }

  return {
    reply: t("vr.success", { level, effectiveVr: value }),
    pending: null,
    action: {
      type: "set_vr",
      vr: value,
      ashedMemberId: input.ashedMemberId,
      ...(input.commanderId ? { commanderId: input.commanderId } : {}),
    },
  };
}

export function processVrCommand(input: ProcessVrCommandInput): VrCommandResult {
  const { explicitLevel, seasonHigh, pending, translate: t, seasonKey } = input;

  if (pending?.kind === "anomaly_confirm" && explicitLevel == null) {
    return {
      reply: t("vr.stillWaiting", {
        level: instituteLevelLabel(seasonKey, pending.proposedVr),
      }),
      pending,
      action: { type: "none" },
      needsConfirmation: true,
      proposedVr: pending.proposedVr,
    };
  }

  if (explicitLevel != null) {
    const validated = validateBaseVrForSeason(seasonKey, explicitLevel);
    if (!validated.ok) {
      return {
        reply: formatBaseVrValidationError(validated),
        pending,
        action: { type: "none" },
      };
    }
    return applyExplicitLevel(validated.baseVr, input);
  }

  const current = seasonHigh ?? 0;
  const next =
    current <= 0
      ? initialBaseVrForBump(seasonKey)
      : nextBaseVrForSeason(seasonKey, current);
  if (next == null) {
    return {
      reply: t("vr.maxVr", { maxLevel: maxInstituteLevel(seasonKey) }),
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
  const { answer, pending, translate: t, seasonKey } = input;
  if (pending.kind !== "anomaly_confirm") {
    return {
      reply: t("errors.nothingPending"),
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

  const level = instituteLevelLabel(seasonKey, pending.proposedVr);
  return {
    reply: t("vr.success", { level, effectiveVr: pending.proposedVr }),
    pending: null,
    action: {
      type: "set_vr",
      vr: pending.proposedVr,
      ashedMemberId: pending.ashedMemberId ?? "",
      ...(pending.commanderId ? { commanderId: pending.commanderId } : {}),
    },
  };
}
