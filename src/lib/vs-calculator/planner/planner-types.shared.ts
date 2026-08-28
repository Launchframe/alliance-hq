/** Hero Day (VS day 4) score planner — shared types. */

export type HeroSkillTier = "ur" | "ssr" | "sr";

export type HeroDaySpendMode = "free_to_play" | "spending";

export type HeroDayPlannerSettings = {
  spendMode: HeroDaySpendMode;
  /** Hero shard VS burn batch size per tier (default 10). */
  heroShardBatchSizes?: Partial<Record<HeroSkillTier, number>>;
};

export type HeroDayCandidate = {
  id: string;
  label: string;
  tier: HeroSkillTier;
  heroLevel: number;
  skillLevels: [number, number, number];
  /** UR only: 0 = locked, 1–30. */
  exclusiveWeaponLevel?: number;
  /** When weapon level is 0, include 50-shard unlock in upgrade paths. */
  includeWeaponUnlock?: boolean;
  allSkillsSameLevel?: boolean;
};

export type HeroDayPushProfilePayload = {
  heroes: HeroDayCandidate[];
  plannerSpendMode?: HeroDaySpendMode;
  heroShardBatchSizes?: Partial<Record<HeroSkillTier, number>>;
};

export type PlannerActionKind =
  | "skill_upgrade"
  | "hero_level_up"
  | "weapon_upgrade"
  | "hero_shard_burn"
  | "bag_item"
  | "diamond_pack";

export type PlannerAction = {
  kind: PlannerActionKind;
  vsPoints: number;
  labelKey: string;
  labelValues?: Record<string, string | number>;
  heroId?: string;
  skillIndex?: number;
  fromLevel?: number;
  toLevel?: number;
  resourceAmount?: number;
  slug?: string;
  qty?: number;
  packSize?: number;
  tier?: HeroSkillTier;
};

export type HeroDayPlannerRates = {
  skillMedalPointsPerUnit: number;
  heroExpPointsPerUnit: number;
  heroExpMinBatch: number;
  exclusiveWeaponShardPointsPerUnit: number;
  diamondPointsPerUnit: number;
  recruitTicketPoints: number;
  heroShardPoints: Record<HeroSkillTier, number>;
};

export const DEFAULT_HERO_DAY_RATES: HeroDayPlannerRates = {
  skillMedalPointsPerUnit: 25,
  heroExpPointsPerUnit: 2.5,
  heroExpMinBatch: 660,
  exclusiveWeaponShardPointsPerUnit: 25_000,
  diamondPointsPerUnit: 30,
  recruitTicketPoints: 4_500,
  heroShardPoints: { ur: 25_000, ssr: 8_750, sr: 2_500 },
};

export type HeroDayPlannerInput = {
  currentScore: number;
  targetScore: number;
  candidates: HeroDayCandidate[];
  bagQuantities: Record<string, number>;
  settings: HeroDayPlannerSettings;
  rates?: HeroDayPlannerRates;
};

export type HeroDayPlannerMode = "exact" | "nearest_under" | "nearest_over";

export type HeroDayPlan = {
  actions: PlannerAction[];
  totalPoints: number;
  projectedScore: number;
  mode: HeroDayPlannerMode;
  gapPoints: number;
  diamondPacksPurchased: number;
  totalDiamondsPurchased: number;
};
