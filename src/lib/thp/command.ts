import type { DiscordTranslate } from "@/lib/discord/i18n";
import {
  sumThpBreakdown,
  validateThpTotal,
} from "@/lib/thp/breakdown.shared";
import type { ThpBreakdown } from "@/lib/thp/my-thp.shared";
import { shouldThpAnomalyConfirm, buildThpFlagReason } from "@/lib/thp/anomaly";
import type { ThpCommandResult, ThpPendingState } from "@/lib/thp/types";

export type ProcessThpCommandInput = {
  explicitTotal?: number | null;
  explicitBreakdown?: ThpBreakdown | null;
  currentTotal: number | null;
  commanderId: string;
  pending: ThpPendingState | null;
  reporterCount: number;
  peerMax: number;
  translate: DiscordTranslate;
};

export type ProcessThpConfirmationInput = {
  answer: "yes" | "no";
  pending: ThpPendingState;
  translate: DiscordTranslate;
  peerMax: number;
};

function resolveProposed(input: ProcessThpCommandInput): {
  total: number;
  breakdown: ThpBreakdown | null;
} | null {
  if (input.explicitBreakdown) {
    const total = sumThpBreakdown(input.explicitBreakdown);
    if (!validateThpTotal(total)) return null;
    return { total, breakdown: input.explicitBreakdown };
  }
  if (input.explicitTotal != null) {
    if (!validateThpTotal(input.explicitTotal)) return null;
    return { total: Math.round(input.explicitTotal), breakdown: null };
  }
  return null;
}

function applyProposed(
  proposed: { total: number; breakdown: ThpBreakdown | null },
  input: ProcessThpCommandInput,
  confirmKind: "anomaly_confirm" | "ocr_confirm",
): ThpCommandResult {
  const { translate: t } = input;
  if (
    shouldThpAnomalyConfirm({
      proposedTotal: proposed.total,
      reporterCount: input.reporterCount,
      peerMax: input.peerMax,
    })
  ) {
    return {
      reply: t("thp.anomalyConfirm", { total: proposed.total.toLocaleString() }),
      pending: {
        kind: confirmKind,
        proposedTotal: proposed.total,
        proposedBreakdown: proposed.breakdown,
        commanderId: input.commanderId,
      },
      action: { type: "none" },
      needsConfirmation: true,
      proposedTotal: proposed.total,
      proposedBreakdown: proposed.breakdown,
    };
  }

  return {
    reply: t("thp.success", { total: proposed.total.toLocaleString() }),
    pending: null,
    action: {
      type: "set_thp",
      total: proposed.total,
      breakdown: proposed.breakdown,
      commanderId: input.commanderId,
    },
  };
}

export function processThpCommand(input: ProcessThpCommandInput): ThpCommandResult {
  const { translate: t } = input;
  const proposed = resolveProposed(input);
  if (!proposed) {
    return {
      reply: t("thp.usage"),
      pending: input.pending,
      action: { type: "none" },
    };
  }

  if (input.currentTotal != null && proposed.total === input.currentTotal) {
    return {
      reply: t("thp.unchanged"),
      pending: null,
      action: { type: "none" },
    };
  }

  return applyProposed(proposed, input, "anomaly_confirm");
}

export function processThpOcrResult(input: ProcessThpCommandInput): ThpCommandResult {
  const proposed = resolveProposed(input);
  if (!proposed) {
    return {
      reply: input.translate("thp.ocrFailed"),
      pending: null,
      action: { type: "none" },
    };
  }
  return applyProposed(proposed, input, "ocr_confirm");
}

export function processThpConfirmation(
  input: ProcessThpConfirmationInput,
): ThpCommandResult {
  const { translate: t, pending } = input;
  if (pending.kind !== "anomaly_confirm" && pending.kind !== "ocr_confirm") {
    return {
      reply: t("errors.noConfirm"),
      pending: null,
      action: { type: "none" },
    };
  }

  if (input.answer === "no") {
    return {
      reply: t("thp.declined"),
      pending: null,
      action: { type: "none" },
    };
  }

  const flagReason = shouldThpAnomalyConfirm({
    proposedTotal: pending.proposedTotal,
    reporterCount: 0,
    peerMax: input.peerMax,
  })
    ? buildThpFlagReason(pending.proposedTotal, input.peerMax)
    : null;

  return {
    reply: t("thp.success", {
      total: pending.proposedTotal.toLocaleString(),
    }),
    pending: null,
    action: {
      type: "set_thp",
      total: pending.proposedTotal,
      breakdown: pending.proposedBreakdown,
      commanderId: pending.commanderId,
      flagReason,
    },
  };
}
