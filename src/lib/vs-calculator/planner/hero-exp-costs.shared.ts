/**
 * Hero EXP to level — exponential curve aligned with cpt-hedge L1→2 ≈ 4,500 EXP.
 * Replace table when maintainer validates full cpt-hedge export.
 * @see https://cpt-hedge.com/calculators/hero-exp
 */

const HERO_EXP_BASE = 4500;
const HERO_EXP_GROWTH = 1.085;

/** EXP to go from (level - 1) → level. */
export function heroExpStepCost(targetLevel: number): number {
  if (targetLevel <= 1) return 0;
  if (targetLevel === 2) return HERO_EXP_BASE;
  return Math.round(HERO_EXP_BASE * HERO_EXP_GROWTH ** (targetLevel - 2));
}

export function expForHeroUpgrade(fromLevel: number, toLevel: number): number {
  if (toLevel <= fromLevel) return 0;
  let total = 0;
  for (let level = fromLevel + 1; level <= toLevel; level++) {
    total += heroExpStepCost(level);
  }
  return total;
}

/** Round EXP spend up to valid VS tap batches (660 minimum). */
export function expSpendForVsBatches(totalExp: number, minBatch: number): number {
  if (totalExp <= 0) return 0;
  const batches = Math.ceil(totalExp / minBatch);
  return batches * minBatch;
}
