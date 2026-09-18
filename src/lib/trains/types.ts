import type {
  ConductorRule,
  VipRule,
} from "@/lib/trains/rules/catalog.shared";

/**
 * Legacy mechanism vocabulary.
 *
 * Day scheduling now uses `ConductorRule` (see `rules/catalog.shared.ts`).
 * These strings survive only as the permanent history written to
 * `train_conductor_records.conductor_mechanism`.
 */
export const CONDUCTOR_MECHANISMS = [
  "vs_top_n",
  "vr_top_n",
  "r3_lottery",
  "heavy_hitter_lottery",
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

/**
 * Week presets. Each expands to seven calendar-weekday rules in
 * `rules/presets.shared.ts`; a test keeps the two lists in lockstep.
 *
 * The old paint-only segments (`vs_push_weekdays`, `top_vs`, `takedown_week`,
 * …) are gone: a day is painted with a rule, and a week is seven rules. A
 * segment was only ever "the same rule on several days".
 */
export const WEEK_TEMPLATES = [
  "vs_push_week",
  "vs_push_week_lead_time",
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
  "heavy_hitter",
] as const;

export type PoolType = (typeof POOL_TYPES)[number];

export type EventTopXConfig = {
  eventKey: string;
  topN: number;
};

/**
 * A scheduled day. `conductorRule: null` is free choice — an officer assigns
 * anyone — and `vipRule: null` is the conductor's free pick. Neither means
 * "unset"; a skipped VIP is `{ kind: "none" }`.
 */
export type DayConfigInput = {
  date: string;
  conductorRule: ConductorRule | null;
  vipRule: VipRule | null;
  /** Template this day was painted from. Provenance only. */
  sourceTemplateKey?: string | null;
};

import type { MemberQualificationPayload } from "@/lib/trains/train-conductor-minimums.shared";

export type RollCandidate = {
  memberId: string;
  memberName: string;
  allianceRank?: number | null;
  ticketCount?: number;
  priorDayVsScore?: number;
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
