/**
 * Pure step derivation for Trains Simple Mode guided conductor flow.
 *
 * When VS / Price Is Freight score data is required but missing, the flow
 * blocks at the `"prerequisites"` step — the officer must upload scores
 * before spinning for conductor.
 */

export type GuidedFlowStep =
  | "prerequisites"
  | "template"
  | "conductor"
  | "vip"
  | "lock"
  | "done";

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
 * Whether the prerequisites step should show as blocking.
 * True when VS/PIF data is required, not ready, not locked, and the template
 * is already chosen (so the next natural step would be conductor).
 */
export function guidedFlowPrerequisitesBlocking(
  input: GuidedFlowInput,
): boolean {
  if (input.locked) return false;
  if (!input.schedulePersisted) return false;
  return Boolean(input.vsDataRequired) && !input.vsDataReady;
}

/**
 * First incomplete step for the guided flow primary CTA.
 * Blocks at `"prerequisites"` when score data is required but missing.
 */
export function currentGuidedStep(input: GuidedFlowInput): GuidedFlowStep {
  if (!input.schedulePersisted) return "template";
  if (guidedFlowPrerequisitesBlocking(input)) return "prerequisites";
  if (!input.hasConductor) return "conductor";
  if (input.vipNeeded && !input.hasVip) return "vip";
  if (!input.locked) return "lock";
  return "done";
}
