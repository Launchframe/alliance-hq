import {
  anomalyConfirmMessage,
  shouldAnomalyConfirm,
} from "@/lib/vr/anomaly";
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
};

export type ProcessVrConfirmationInput = {
  answer: "yes" | "no";
  pending: VrPendingState;
};

function successReply(vr: number): string {
  return `Got it! Congrats on ${vr} VR.`;
}

function applyExplicitLevel(
  value: number,
  input: ProcessVrCommandInput,
): VrCommandResult {
  const seasonHigh = input.seasonHigh ?? 0;
  if (value < maxAllowedDowngrade(seasonHigh)) {
    return {
      reply: `Base VR can't drop more than one step (250) below your season high of ${seasonHigh}.`,
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
      reply: anomalyConfirmMessage(value),
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
    reply: successReply(value),
    pending: null,
    action: {
      type: "set_vr",
      vr: value,
      ashedMemberId: input.ashedMemberId,
    },
  };
}

export function processVrCommand(input: ProcessVrCommandInput): VrCommandResult {
  const { explicitLevel, seasonHigh, pending } = input;

  if (pending?.kind === "anomaly_confirm" && explicitLevel == null) {
    return {
      reply: `Still waiting: are you sure it's ${pending.proposedVr}? Tap Yes or No.`,
      pending,
      action: { type: "none" },
      needsConfirmation: true,
      proposedVr: pending.proposedVr,
    };
  }

  if (explicitLevel != null) {
    if (!isValidBaseVr(explicitLevel)) {
      return {
        reply: formatVrValidationError(),
        pending,
        action: { type: "none" },
      };
    }
    return applyExplicitLevel(explicitLevel, input);
  }

  const current = seasonHigh ?? 0;
  const next =
    current <= 0 ? initialBaseVrForBump() : nextBaseVr(current);
  if (!isValidBaseVr(next)) {
    return {
      reply: `You're at the max base VR we track (${next - 250}).`,
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
  const { answer, pending } = input;
  if (pending.kind !== "anomaly_confirm") {
    return {
      reply: "Nothing to confirm right now.",
      pending: null,
      action: { type: "none" },
    };
  }

  if (answer === "no") {
    return {
      reply: "No problem. Send /vr with your corrected base VR when ready.",
      pending: null,
      action: { type: "none" },
    };
  }

  return {
    reply: successReply(pending.proposedVr),
    pending: null,
    action: {
      type: "set_vr",
      vr: pending.proposedVr,
      ashedMemberId: pending.ashedMemberId,
      flagReason: "anomaly_confirmed",
    },
  };
}
