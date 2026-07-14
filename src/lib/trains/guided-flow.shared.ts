/**
 * Pure step derivation for Trains Simple Mode guided conductor flow.
 *
 * Prerequisites (VS / Price Is Freight score data) are informational and
 * non-blocking: use {@link guidedFlowShowPrerequisites} for the banner while
 * {@link currentGuidedStep} focuses the primary CTA on the first incomplete
 * actionable step (template → conductor → vip → lock → done).
 *
 * The `prerequisites` step id remains in {@link GuidedFlowStep} for UI step
 * lists; `currentGuidedStep` does not return it.
 */

export type GuidedFlowStep =
  | "prerequisites"
  | "template"
  | "conductor"
  | "vip"
  | "lock"
  | "done";

/** Actionable CTA focus — excludes informational prerequisites. */
export type GuidedFlowActionStep = Exclude<GuidedFlowStep, "prerequisites">;

export type GuidedFlowInput = {
  /** Week schedule row persisted in `train_week_schedules`. */
  schedulePersisted: boolean;
  /** Conductor assigned for the selected day. */
  hasConductor: boolean;
  /**
   * VIP step applies when the day's vip mechanism is set and not `"none"`.
   * When false, the VIP step is skipped.
   */
  vipNeeded: boolean;
  /** VIP member assigned, or guardian-is-VIP satisfied. */
  hasVip: boolean;
  /** Conductor record locked for the selected day. */
  locked: boolean;
  /**
   * VS/PIF score data is required for today's mechanism/paint
   * (`vsDataStatus.required`).
   */
  vsDataRequired?: boolean;
  /** Score data ready (`vsDataStatus.ready`). */
  vsDataReady?: boolean;
};

/**
 * Whether the UI should surface the VS/PIF prerequisites banner.
 * Non-blocking — does not change {@link currentGuidedStep}.
 * Hidden once locked (All Set) so missing scores do not nag after the ritual.
 */
export function guidedFlowShowPrerequisites(input: GuidedFlowInput): boolean {
  if (input.locked) return false;
  return Boolean(input.vsDataRequired) && !input.vsDataReady;
}

/**
 * First incomplete actionable step for the guided flow primary CTA.
 */
export function currentGuidedStep(input: GuidedFlowInput): GuidedFlowActionStep {
  if (!input.schedulePersisted) return "template";
  if (!input.hasConductor) return "conductor";
  if (input.vipNeeded && !input.hasVip) return "vip";
  if (!input.locked) return "lock";
  return "done";
}
