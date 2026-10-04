import type {
  ConductorRule,
  VipRule,
} from "@/lib/trains/rules/catalog.shared";

export type ConductorNominationStatus =
  | "awaiting_scores"
  | "pending_confirmation"
  | "confirmed"
  | "forfeited"
  | "fallback_r4";

/** Lock is allowed when confirmation is off or the nomination window is satisfied. */
export function isConductorConfirmationSatisfied(
  confirmationEnabled: boolean,
  status: string | null | undefined,
): boolean {
  if (!confirmationEnabled) return true;
  return (
    status === "confirmed" ||
    status === "fallback_r4" ||
    status == null
  );
}

export function conductorLockBlockedByPendingConfirmation(
  confirmationEnabled: boolean,
  status: string | null | undefined,
): boolean {
  return (
    confirmationEnabled && status === "pending_confirmation"
  );
}

export type WeekConductorRecordSummary = {
  id: string;
  date: string;
  conductorMemberId: string | null;
  conductorMemberName: string | null;
  vipMemberId: string | null;
  vipMemberName: string | null;
  /** Rule this pick was made under — drives "is this still today's pick". */
  conductorRule: ConductorRule | null;
  vipRule: VipRule | null;
  /** Legacy mechanism snapshot, retained for history display. */
  conductorMechanism: string | null;
  vipMechanism: string | null;
  guardianIsVip: boolean;
  lockedAt: string | null;
  /** True when this session may unlock this locked day right now. */
  canUnlock?: boolean;
  substituteForMemberId: string | null;
  substituteForMemberName: string | null;
  /** awaiting_scores | pending_confirmation | confirmed | forfeited | fallback_r4 */
  conductorNominationStatus?: string | null;
  nominationTrigger?: string | null;
  confirmationDeadlineAt?: string | null;
  successorAttempt?: number;
  /** Officer confirmed a manual-pick eligibility override for this conductor. */
  eligibilityOverridden?: boolean;
};
