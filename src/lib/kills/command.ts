import type { DiscordTranslate } from "@/lib/discord/i18n";
import { formatKillsTotalForDiscord } from "@/lib/kills/format.shared";
import { validateKillsTotal } from "@/lib/kills/constants";
import {
  shouldKillsAnomalyConfirm,
  buildKillsFlagReason,
} from "@/lib/kills/anomaly";
import { buildKillsDiscordSuccessReply } from "@/lib/kills/discord-success-reply";
import type { KillsCommandResult, KillsPendingState } from "@/lib/kills/types";

export type ProcessKillsCommandInput = {
  explicitTotal?: number | null;
  currentTotal: number | null;
  previousUpdatedAt?: Date | null;
  commanderName?: string | null;
  commanderId: string;
  pending: KillsPendingState | null;
  reporterCount: number;
  peerMax: number;
  translate: DiscordTranslate;
};

export type ProcessKillsConfirmationInput = {
  answer: "yes" | "no";
  pending: KillsPendingState;
  translate: DiscordTranslate;
  peerMax: number;
  currentTotal: number | null;
  previousUpdatedAt?: Date | null;
  commanderName?: string | null;
};

function successReply(
  t: DiscordTranslate,
  total: number,
  input: {
    commanderName?: string | null;
    currentTotal: number | null;
    previousUpdatedAt?: Date | null;
  },
): string {
  return buildKillsDiscordSuccessReply(t, {
    commanderName: input.commanderName ?? "Commander",
    total,
    previousTotal: input.currentTotal,
    previousAt: input.previousUpdatedAt ?? null,
  });
}

function resolveProposed(input: ProcessKillsCommandInput): number | null {
  if (input.explicitTotal != null) {
    if (!validateKillsTotal(input.explicitTotal)) return null;
    return Math.round(input.explicitTotal);
  }
  return null;
}

function applyProposed(
  proposedTotal: number,
  input: ProcessKillsCommandInput,
  confirmKind: "anomaly_confirm" | "ocr_confirm" = "anomaly_confirm",
): KillsCommandResult {
  const { translate: t } = input;
  if (
    shouldKillsAnomalyConfirm({
      proposedTotal,
      reporterCount: input.reporterCount,
      peerMax: input.peerMax,
    })
  ) {
    return {
      reply: t("kills.anomalyConfirm", {
        total: formatKillsTotalForDiscord(proposedTotal),
      }),
      pending: {
        kind: confirmKind,
        proposedTotal,
        commanderId: input.commanderId,
      },
      action: { type: "none" },
      needsConfirmation: true,
      proposedTotal,
    };
  }

  return {
    reply: successReply(t, proposedTotal, input),
    pending: null,
    action: {
      type: "set_kills",
      total: proposedTotal,
      commanderId: input.commanderId,
    },
  };
}

export function processKillsCommand(
  input: ProcessKillsCommandInput,
): KillsCommandResult {
  const { translate: t } = input;
  const proposed = resolveProposed(input);
  if (proposed == null) {
    return {
      reply: t("kills.usage"),
      pending: input.pending,
      action: { type: "none" },
    };
  }

  if (input.currentTotal != null && proposed === input.currentTotal) {
    return {
      reply: t("kills.unchanged"),
      pending: null,
      action: { type: "none" },
    };
  }

  return applyProposed(proposed, input, "anomaly_confirm");
}

export function processKillsOcrResult(
  input: ProcessKillsCommandInput,
): KillsCommandResult {
  const proposed = resolveProposed(input);
  if (proposed == null) {
    return {
      reply: input.translate("kills.ocrFailed"),
      pending: null,
      action: { type: "none" },
    };
  }
  if (input.currentTotal != null && proposed === input.currentTotal) {
    return {
      reply: input.translate("kills.unchanged"),
      pending: null,
      action: { type: "none" },
    };
  }
  return applyProposed(proposed, input, "ocr_confirm");
}

export function processKillsConfirmation(
  input: ProcessKillsConfirmationInput,
): KillsCommandResult {
  const { translate: t, pending } = input;
  if (pending.kind !== "anomaly_confirm" && pending.kind !== "ocr_confirm") {
    return {
      reply: t("errors.noConfirm"),
      pending: null,
      action: { type: "none" },
    };
  }

  if (
    typeof pending.proposedTotal !== "number" ||
    !Number.isFinite(pending.proposedTotal)
  ) {
    return {
      reply: t("errors.noConfirm"),
      pending: null,
      action: { type: "none" },
    };
  }

  if (input.answer === "no") {
    return {
      reply: t("kills.declined"),
      pending: null,
      action: { type: "none" },
    };
  }

  const flagReason = shouldKillsAnomalyConfirm({
    proposedTotal: pending.proposedTotal,
    reporterCount: 0,
    peerMax: input.peerMax,
  })
    ? buildKillsFlagReason(pending.proposedTotal, input.peerMax)
    : null;

  return {
    reply: successReply(t, pending.proposedTotal, input),
    pending: null,
    action: {
      type: "set_kills",
      total: pending.proposedTotal,
      commanderId: pending.commanderId,
      flagReason,
    },
  };
}
