export const WEEKLY_PASS_BOOST = 250;

export function effectiveBaseVr(
  highestBaseVr: number,
  weeklyPassActive: boolean,
): number {
  return highestBaseVr + (weeklyPassActive ? WEEKLY_PASS_BOOST : 0);
}
