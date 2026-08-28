/** Diamond store packs for Spending mode — Hero Day planner. */

export const HERO_DAY_DIAMOND_PACK_SIZES = [
  500, 1_000, 2_000, 2_500, 5_000, 10_000,
] as const;

export type HeroDayDiamondPackSize = (typeof HERO_DAY_DIAMOND_PACK_SIZES)[number];

export function vsPointsForDiamondPack(
  packSize: number,
  pointsPerDiamond: number,
): number {
  return packSize * pointsPerDiamond;
}
