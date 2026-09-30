/**
 * Spin sources are derived from the day's rule. Kept as a module so the many
 * existing importers of `SpinSource` keep working; the logic lives in
 * `rules/derive.shared.ts`.
 */
export {
  isPoolSpinSource,
  isPriceIsRightSpinSource,
  spinSourceForConductorRule,
  spinSourceForVipRule,
} from "@/lib/trains/rules/derive.shared";

export type {
  DonationsLeaderboardSpinSource,
  EventLeaderboardSpinSource,
  PoolSpinSource,
  PriceIsRightHeavyHitterSpinSource,
  PriceIsRightWeekdaySpinSource,
  SpinSource,
  VrLeaderboardSpinSource,
  VsLeaderboardSpinSource,
} from "@/lib/trains/rules/derive.shared";
