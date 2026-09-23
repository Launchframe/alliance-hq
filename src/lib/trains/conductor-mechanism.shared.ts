import {
  conductorRuleChanged,
  conductorRuleIdentity,
  type ConductorRule,
} from "@/lib/trains/rules/catalog.shared";

/**
 * Rule-level questions about a day's conductor.
 *
 * `effectiveConductorMechanism` is gone: there is no longer a stored
 * mechanism to reconcile against a paint template and a weekday. The rule is
 * the answer.
 */

export {
  canSpinConductorForRule,
  canSpinVipForRule,
  conductorRuleNeedsWheel,
} from "@/lib/trains/rules/derive.shared";

export { conductorRuleChanged, conductorRuleIdentity };

/**
 * A pending pick made under a different rule is not a pick for today.
 *
 * Compares the rule the pick was made under with the day's current rule, so
 * re-painting the same board at the same scope keeps the pick — the old
 * mechanism-string comparison reported a change between the two encodings of
 * Top 10 VS.
 */
export function hasValidConductorPickForDay(input: {
  conductorMemberId: string | null | undefined;
  recordRule: ConductorRule | null;
  dayRule: ConductorRule | null;
  /** False when the record predates rules and carries no snapshot. */
  recordHasRule: boolean;
}): boolean {
  if (!input.conductorMemberId) return false;
  if (!input.recordHasRule) return true;
  return (
    conductorRuleIdentity(input.recordRule) ===
    conductorRuleIdentity(input.dayRule)
  );
}
