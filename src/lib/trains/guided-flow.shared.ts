/**
 * Pure step derivation for Trains Simple Mode guided conductor flow.
 *
 * When roster or VS / Price Is Freight prerequisites are missing, the flow
 * blocks before spinning for conductor.
 */

export type GuidedFlowStep =
  | "roster"
  | "prerequisites"
  | "conductor"
  | "vip"
  | "lock"
  | "done";

export type GuidedFlowInput = {
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
   * Roster data is required for today's conductor actions
   * (`rosterDataStatus.required`).
   */
  rosterDataRequired?: boolean;
  /** Roster ready (`rosterDataStatus.ready`). */
  rosterDataReady?: boolean;
  /**
   * VS/PIF score data is required for today's mechanism/paint
   * (`vsDataStatus.required`).
   */
  vsDataRequired?: boolean;
  /** Score data ready (`vsDataStatus.ready`). */
  vsDataReady?: boolean;
  /**
   * Manual conductor pick is available today. Missing scores must not block
   * the flow (e.g. R3 recognition, or officer override when data is late).
   */
  conductorManualPickAvailable?: boolean;
};

/**
 * Whether the roster step should show as blocking.
 */
export function guidedFlowRosterBlocking(input: GuidedFlowInput): boolean {
  if (input.locked) return false;
  return Boolean(input.rosterDataRequired) && !input.rosterDataReady;
}

/**
 * Whether the prerequisites step should show as blocking.
 * True when VS/PIF data is required for a wheel spin, not ready, not locked,
 * and manual pick is not an available bypass.
 */
export function guidedFlowPrerequisitesBlocking(
  input: GuidedFlowInput,
): boolean {
  if (input.locked) return false;
  if (guidedFlowRosterBlocking(input)) return false;
  if (input.conductorManualPickAvailable) return false;
  return Boolean(input.vsDataRequired) && !input.vsDataReady;
}

/**
 * First incomplete step for the guided flow primary CTA.
 */
export function currentGuidedStep(input: GuidedFlowInput): GuidedFlowStep {
  if (guidedFlowRosterBlocking(input)) return "roster";
  if (guidedFlowPrerequisitesBlocking(input)) return "prerequisites";
  if (!input.hasConductor) return "conductor";
  if (input.vipNeeded && !input.hasVip) return "vip";
  if (!input.locked) return "lock";
  return "done";
}
