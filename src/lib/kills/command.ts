import type { DiscordTranslate } from "@/lib/discord/i18n";
import { formatKillsTotalForDiscord } from "@/lib/kills/format.shared";
import { validateKillsTotal } from "@/lib/kills/constants";
import {
  shouldKillsAnomalyConfirm,
  buildKillsFlagReason,
} from "@/lib/kills/anomaly";
import type { KillsCommandResult, KillsPendingState } from "@/lib/kills/types";

export type ProcessKillsCommandInput = {
  explicitTotal?: number | null;
  currentTotal: number | null;
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
};

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
        kind: "anomaly_confirm",
        proposedTotal,
        commanderId: input.commanderId,
      },
      action: { type: "none" },
      needsConfirmation: true,
      proposedTotal,
    };
  }

  return {
    reply: t("kills.success", { total: formatKillsTotalForDiscord(proposedTotal) }),
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

  return applyProposed(proposed, input);
}

export function processKillsConfirmation(
  input: ProcessKillsConfirmationInput,
): KillsCommandResult {
  const { translate: t, pending } = input;
  if (pending.kind !== "anomaly_confirm") {
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
    reply: t("kills.success", {
      total: formatKillsTotalForDiscord(pending.proposedTotal),
    }),
    pending: null,
    action: {
      type: "set_kills",
      total: pending.proposedTotal,
      commanderId: pending.commanderId,
      flagReason,
    },
  };
}
