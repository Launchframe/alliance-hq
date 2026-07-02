export const CONDUCTOR_MECHANISMS = [
  "vs_high_score",
  "vs_top_10",
  "r3_lottery",
  "r4_sequence",
  "donations_top",
  "officer_pick",
  "event_top_x_lottery",
  "custom",
] as const;

export type ConductorMechanismType = (typeof CONDUCTOR_MECHANISMS)[number];

export const VIP_MECHANISMS = [
  "conductor_pick",
  "donations_second",
  "event_top_x_lottery",
  "none",
] as const;

export type VipMechanismType = (typeof VIP_MECHANISMS)[number];

export const WEEK_TEMPLATES = [
  "vs_push_week",
  "vs_push_weekdays",
  "r4_event_vip",
  "economy_week",
  "price_is_right",
  "r3_recognition",
  "r4_train_week",
  "donations_week",
  "custom",
] as const;

export type WeekTemplateType = (typeof WEEK_TEMPLATES)[number];

export const POOL_TYPES = [
  "r3",
  "r4_plus",
  "all_members",
  "event_top_x",
] as const;

export type PoolType = (typeof POOL_TYPES)[number];

export type EventTopXConfig = {
  eventKey: string;
  topN: number;
};

export type DayConfigInput = {
  date: string;
  conductorMechanism: ConductorMechanismType;
  conductorConfig?: EventTopXConfig | Record<string, unknown> | null;
  vipMechanism?: VipMechanismType | null;
  vipConfig?: EventTopXConfig | Record<string, unknown> | null;
};

import type { MemberQualificationPayload } from "@/lib/trains/train-conductor-minimums.shared";

export type RollCandidate = {
  memberId: string;
  memberName: string;
  allianceRank?: number | null;
};

export type RollResult = {
  memberId: string;
  memberName: string;
  mechanism: ConductorMechanismType | VipMechanismType;
  isAutomatic: boolean;
  poolType?: PoolType;
  /** Names shown on the conductor/VIP wheel (full eligible pool for this roll). */
  wheelCandidates?: RollCandidate[];
  /** Set when the last pool pick exhausted the generation and a new one was seeded. */
  poolRefreshed?: PoolRefreshedInfo;
  /** Conductor minimum VS/donation check for the evaluation window before train day. */
  qualification?: MemberQualificationPayload;
  /** False when the roll landed on a disqualified member and no draft was saved yet. */
  draftPersisted?: boolean;
};

export type PoolRefreshedInfo = {
  poolType: PoolType;
  generation: number;
  memberCount: number;
};

export type ConductorStats = {
  lastConductedDate: string | null;
  conductsThisYear: number;
};
