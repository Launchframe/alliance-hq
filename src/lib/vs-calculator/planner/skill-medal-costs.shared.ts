/**
 * Skill medal cost per level step — cpt-hedge parity.
 * @see https://cpt-hedge.com/calculators/skill-medals
 */

import type { HeroSkillTier } from "@/lib/vs-calculator/planner/planner-types.shared";

/** Cost to upgrade skill from (level - 1) → level. Index = target level. */
const UR_SKILL_STEP: number[] = [
  0, 0, 200, 200, 400, 400, 600, 600, 800, 800, 1200, 1600, 2400, 3200, 4000,
  4800, 5600, 6400, 7200, 8000, 9200, 10400, 11600, 12800, 14000, 15200, 16400,
  18000, 20000, 22000, 24000, 26000, 28000, 30000, 32000, 34000, 36000, 38000,
  40000, 42000, 44000,
];

const SSR_SKILL_STEP: number[] = [
  0, 0, 180, 180, 360, 360, 540, 540, 720, 720, 1080, 1440, 2160, 2880, 3600,
  4320, 5040, 5760, 6480, 7200, 8280, 9360, 10440, 11520, 12600, 13680, 14760,
  16200, 18000, 19800, 21600,
];

const SR_SKILL_STEP: number[] = [
  0, 0, 160, 160, 320, 320, 480, 480, 640, 640, 960, 1280, 1920, 2560, 3200,
  3840, 4480, 5120, 5760, 6400, 7360, 8320, 9280, 10240, 11200, 12160, 13320,
  14400, 16000, 17600, 19200,
];

const MAX_SKILL_LEVEL: Record<HeroSkillTier, number> = {
  ur: 40,
  ssr: 30,
  sr: 30,
};

function stepTable(tier: HeroSkillTier): number[] {
  switch (tier) {
    case "ur":
      return UR_SKILL_STEP;
    case "ssr":
      return SSR_SKILL_STEP;
    case "sr":
      return SR_SKILL_STEP;
  }
}

export function maxSkillLevelForTier(tier: HeroSkillTier): number {
  return MAX_SKILL_LEVEL[tier];
}

export function skillMedalStepCost(
  tier: HeroSkillTier,
  targetLevel: number,
): number {
  if (targetLevel < 2) return 0;
  const table = stepTable(tier);
  if (targetLevel >= table.length) return 0;
  return table[targetLevel] ?? 0;
}

export function medalsForSkillUpgrade(
  tier: HeroSkillTier,
  fromLevel: number,
  toLevel: number,
): number {
  if (toLevel <= fromLevel) return 0;
  const max = maxSkillLevelForTier(tier);
  const cappedTo = Math.min(toLevel, max);
  let total = 0;
  for (let level = fromLevel + 1; level <= cappedTo; level++) {
    total += skillMedalStepCost(tier, level);
  }
  return total;
}
