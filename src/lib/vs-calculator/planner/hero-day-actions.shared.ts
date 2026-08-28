import {
  HERO_DAY_DIAMOND_PACK_SIZES,
  vsPointsForDiamondPack,
} from "@/lib/vs-calculator/planner/diamond-pack-ladder.shared";
import {
  expForHeroUpgrade,
  expSpendForVsBatches,
} from "@/lib/vs-calculator/planner/hero-exp-costs.shared";
import type {
  HeroDayCandidate,
  HeroDayPlannerInput,
  HeroDayPlannerRates,
  HeroDayPlannerSettings,
  HeroSkillTier,
  PlannerAction,
} from "@/lib/vs-calculator/planner/planner-types.shared";
import { DEFAULT_HERO_DAY_RATES } from "@/lib/vs-calculator/planner/planner-types.shared";
import {
  maxSkillLevelForTier,
  medalsForSkillUpgrade,
} from "@/lib/vs-calculator/planner/skill-medal-costs.shared";
import { shardsForWeaponUpgrade } from "@/lib/vs-calculator/planner/weapon-shard-costs.shared";

const DEFAULT_SHARD_BATCH = 10;
const MAX_HERO_LEVEL_WINDOW = 25;
const MAX_BAG_RECRUIT_ACTIONS = 32;

function shardBatchSize(
  tier: HeroSkillTier,
  settings: HeroDayPlannerSettings,
): number {
  const custom = settings.heroShardBatchSizes?.[tier];
  return custom != null && custom > 0 ? custom : DEFAULT_SHARD_BATCH;
}

function addSkillUpgradeActions(
  actions: PlannerAction[],
  hero: HeroDayCandidate,
  skillIndex: number,
  rates: HeroDayPlannerRates,
): void {
  const from = hero.skillLevels[skillIndex] ?? 1;
  const max = maxSkillLevelForTier(hero.tier);
  for (let to = from + 1; to <= max; to++) {
    const medals = medalsForSkillUpgrade(hero.tier, from, to);
    if (medals <= 0) continue;
    const vsPoints = medals * rates.skillMedalPointsPerUnit;
    actions.push({
      kind: "skill_upgrade",
      vsPoints,
      labelKey: "vsCalculator.plan.actions.skillUpgrade",
      labelValues: {
        hero: hero.label,
        skill: skillIndex + 1,
        from,
        to,
        medals,
      },
      heroId: hero.id,
      skillIndex,
      fromLevel: from,
      toLevel: to,
      resourceAmount: medals,
    });
  }
}

function addHeroLevelActions(
  actions: PlannerAction[],
  hero: HeroDayCandidate,
  rates: HeroDayPlannerRates,
): void {
  const from = hero.heroLevel;
  const maxTo = from + MAX_HERO_LEVEL_WINDOW;
  for (let to = from + 1; to <= maxTo; to++) {
    const rawExp = expForHeroUpgrade(from, to);
    const expSpent = expSpendForVsBatches(rawExp, rates.heroExpMinBatch);
    const vsPoints = expSpent * rates.heroExpPointsPerUnit;
    if (vsPoints <= 0) continue;
    actions.push({
      kind: "hero_level_up",
      vsPoints,
      labelKey: "vsCalculator.plan.actions.heroLevelUp",
      labelValues: { hero: hero.label, from, to, exp: expSpent },
      heroId: hero.id,
      fromLevel: from,
      toLevel: to,
      resourceAmount: expSpent,
    });
  }
}

function addWeaponUpgradeActions(
  actions: PlannerAction[],
  hero: HeroDayCandidate,
  rates: HeroDayPlannerRates,
): void {
  if (hero.tier !== "ur") return;
  const from = hero.exclusiveWeaponLevel ?? 0;
  for (let to = from + 1; to <= 30; to++) {
    const includeUnlock = from === 0 && (hero.includeWeaponUnlock ?? true);
    const shards = shardsForWeaponUpgrade(from, to, { includeUnlock });
    if (shards <= 0) continue;
    const vsPoints = shards * rates.exclusiveWeaponShardPointsPerUnit;
    actions.push({
      kind: "weapon_upgrade",
      vsPoints,
      labelKey: "vsCalculator.plan.actions.weaponUpgrade",
      labelValues: { hero: hero.label, from, to, shards },
      heroId: hero.id,
      fromLevel: from,
      toLevel: to,
      resourceAmount: shards,
    });
  }
}

function addHeroShardBurnActions(
  actions: PlannerAction[],
  tier: HeroSkillTier,
  maxQty: number,
  settings: HeroDayPlannerSettings,
  rates: HeroDayPlannerRates,
): void {
  const batch = shardBatchSize(tier, settings);
  const pointsPer = rates.heroShardPoints[tier];
  const maxBatches = Math.floor(maxQty / batch);
  for (let batches = 1; batches <= maxBatches; batches++) {
    const count = batches * batch;
    actions.push({
      kind: "hero_shard_burn",
      vsPoints: count * pointsPer,
      labelKey: "vsCalculator.plan.actions.heroShardBurn",
      labelValues: { tier: tier.toUpperCase(), count },
      tier,
      qty: count,
      resourceAmount: count,
    });
  }
}

export function buildHeroDayActions(
  input: HeroDayPlannerInput,
): PlannerAction[] {
  const rates = input.rates ?? DEFAULT_HERO_DAY_RATES;
  const actions: PlannerAction[] = [];

  for (const hero of input.candidates) {
    for (let skillIndex = 0; skillIndex < 3; skillIndex++) {
      addSkillUpgradeActions(actions, hero, skillIndex, rates);
    }
    addHeroLevelActions(actions, hero, rates);
    addWeaponUpgradeActions(actions, hero, rates);
  }

  const recruitQty = Math.min(
    input.bagQuantities.recruit_ticket ?? 0,
    MAX_BAG_RECRUIT_ACTIONS,
  );
  for (let i = 0; i < recruitQty; i++) {
    actions.push({
      kind: "bag_item",
      vsPoints: rates.recruitTicketPoints,
      labelKey: "vsCalculator.plan.actions.recruitTicket",
      slug: "recruit_ticket",
      qty: 1,
    });
  }

  const diamondQty = input.bagQuantities.diamond ?? 0;
  if (diamondQty > 0) {
    actions.push({
      kind: "bag_item",
      vsPoints: diamondQty * rates.diamondPointsPerUnit,
      labelKey: "vsCalculator.plan.actions.bagDiamonds",
      labelValues: { count: diamondQty },
      slug: "diamond",
      qty: diamondQty,
      resourceAmount: diamondQty,
    });
  }

  for (const tier of ["ur", "ssr", "sr"] as const) {
    const slug = `${tier}_shard`;
    addHeroShardBurnActions(
      actions,
      tier,
      input.bagQuantities[slug] ?? 0,
      input.settings,
      rates,
    );
  }

  if (input.settings.spendMode === "spending") {
    for (const packSize of HERO_DAY_DIAMOND_PACK_SIZES) {
      actions.push({
        kind: "diamond_pack",
        vsPoints: vsPointsForDiamondPack(packSize, rates.diamondPointsPerUnit),
        labelKey: "vsCalculator.plan.actions.diamondPack",
        labelValues: { count: packSize },
        packSize,
        resourceAmount: packSize,
      });
    }
  }

  return actions;
}

export function isRepeatablePlannerAction(action: PlannerAction): boolean {
  return (
    action.kind === "diamond_pack" ||
    (action.kind === "bag_item" && action.slug === "recruit_ticket")
  );
}

/** Unique non-repeatable actions (upgrades, bag diamond lump, shard burns). */
export function partitionPlannerActions(actions: PlannerAction[]): {
  unique: PlannerAction[];
  repeatable: PlannerAction[];
} {
  const unique: PlannerAction[] = [];
  const repeatable: PlannerAction[] = [];
  for (const action of actions) {
    if (isRepeatablePlannerAction(action)) {
      repeatable.push(action);
    } else {
      unique.push(action);
    }
  }
  return { unique, repeatable };
}
