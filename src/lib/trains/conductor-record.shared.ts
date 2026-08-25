export type WeekConductorRecordSummary = {
  id: string;
  date: string;
  conductorMemberId: string | null;
  conductorMemberName: string | null;
  vipMemberId: string | null;
  vipMemberName: string | null;
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
};
