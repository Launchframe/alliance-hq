export type LinkPhonePhase = "idle" | "showing" | "linked" | "error";

export type LinkPhonePhaseEvent =
  | "reveal"
  | "hide"
  | "linked"
  | "error"
  | "retry";

export function reduceLinkPhonePhase(
  phase: LinkPhonePhase,
  event: LinkPhonePhaseEvent,
): LinkPhonePhase {
  switch (phase) {
    case "idle":
      if (event === "reveal") return "showing";
      return phase;
    case "showing":
      if (event === "hide") return "idle";
      if (event === "linked") return "linked";
      if (event === "error") return "error";
      return phase;
    case "linked":
      return phase;
    case "error":
      if (event === "retry") return "showing";
      if (event === "hide") return "idle";
      return phase;
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}

/** Only show alliance picker after paste input parses to a valid token. */
export function shouldShowAlliancePicker(parsePreviewOk: boolean | undefined): boolean {
  return parsePreviewOk === true;
}

export function getContinueToHqLabelKey(phoneLinked: boolean): string {
  return phoneLinked
    ? "steps.linkPhone.continueToHq"
    : "steps.linkPhone.continueWithoutPhone";
}
