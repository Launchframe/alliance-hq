/**
 * Exclusive weapon shard costs — cpt-hedge parity.
 * @see https://cpt-hedge.com/calculators/weapon-shards
 */

export const WEAPON_UNLOCK_SHARD_COST = 50;
export const MAX_EXCLUSIVE_WEAPON_LEVEL = 30;

/** Shards to go from (level - 1) → level after unlock. Index = target level. */
function weaponUpgradeStepCost(targetLevel: number): number {
  if (targetLevel <= 1) return 0;
  if (targetLevel <= 5) return 20;
  if (targetLevel <= 10) return 40;
  if (targetLevel <= 15) return 60;
  if (targetLevel <= 20) return 100;
  if (targetLevel <= 25) return 150;
  if (targetLevel <= 30) return 200;
  return 0;
}

export function shardsForWeaponUpgrade(
  fromLevel: number,
  toLevel: number,
  options?: { includeUnlock?: boolean },
): number {
  if (toLevel <= fromLevel) return 0;
  const cappedTo = Math.min(toLevel, MAX_EXCLUSIVE_WEAPON_LEVEL);
  let total = 0;
  let current = fromLevel;

  if (current === 0 && options?.includeUnlock && cappedTo >= 1) {
    total += WEAPON_UNLOCK_SHARD_COST;
    current = 1;
  }

  for (let level = current + 1; level <= cappedTo; level++) {
    total += weaponUpgradeStepCost(level);
  }
  return total;
}
