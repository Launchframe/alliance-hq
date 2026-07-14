import { effectiveConductorMechanism } from "@/lib/trains/conductor-mechanism.shared";
import { isPriceIsRightHeavyHitterSaturday } from "@/lib/trains/heavy-hitter-pool.shared";
import {
  conductorMechanismPoolType,
  vipMechanismPoolType,
} from "@/lib/trains/templates";
import type { PoolType, VipMechanismType, WeekTemplateType } from "@/lib/trains/types";

export type PoolSpinSource = {
  kind: "pool";
  poolType: PoolType;
};

export type VsLeaderboardSpinSource = {
  kind: "vs_leaderboard";
  topN: number;
};

export type DonationsLeaderboardSpinSource = {
  kind: "donations_leaderboard";
  rank: 1 | 2;
};

export type EventLeaderboardSpinSource = {
  kind: "event_leaderboard";
};

/** Price Is Freight weekday raffle / uniform draw (not a depleting pool UI). */
export type PriceIsRightWeekdaySpinSource = {
  kind: "price_is_right_raffle";
};

/** Price Is Freight Saturday heavy-hitter draw (not a depleting pool UI). */
export type PriceIsRightHeavyHitterSpinSource = {
  kind: "price_is_right_heavy_hitter";
};

export type SpinSource =
  | PoolSpinSource
  | VsLeaderboardSpinSource
  | DonationsLeaderboardSpinSource
  | EventLeaderboardSpinSource
  | PriceIsRightWeekdaySpinSource
  | PriceIsRightHeavyHitterSpinSource
  | null;

export function conductorSpinSource(
  conductorMechanism: string | null | undefined,
  paintTemplate?: WeekTemplateType | null,
  date?: string | null,
): SpinSource {
  if (paintTemplate === "price_is_right") {
    if (isPriceIsRightHeavyHitterSaturday(paintTemplate, date)) {
      return { kind: "price_is_right_heavy_hitter" };
    }
    return { kind: "price_is_right_raffle" };
  }

  const mechanism = effectiveConductorMechanism(
    conductorMechanism,
    paintTemplate,
    date,
  );
  if (!mechanism) return null;

  const poolType = conductorMechanismPoolType(mechanism);
  if (poolType) {
    return { kind: "pool", poolType };
  }

  if (mechanism === "vs_top_10") {
    return { kind: "vs_leaderboard", topN: 10 };
  }
  if (mechanism === "vs_high_score") {
    return { kind: "vs_leaderboard", topN: 1 };
  }
  if (mechanism === "donations_top") {
    return { kind: "donations_leaderboard", rank: 1 };
  }

  return null;
}

export function vipSpinSource(
  vipMechanism: string | null | undefined,
): SpinSource {
  if (!vipMechanism || vipMechanism === "none" || vipMechanism === "conductor_pick") {
    return null;
  }
  if (vipMechanism === "donations_second") {
    return { kind: "donations_leaderboard", rank: 2 };
  }
  const poolType = vipMechanismPoolType(vipMechanism as VipMechanismType);
  if (poolType) {
    return { kind: "pool", poolType };
  }
  return null;
}

export function isPoolSpinSource(
  source: SpinSource,
): source is PoolSpinSource {
  return source?.kind === "pool";
}

export function isPriceIsRightSpinSource(
  source: SpinSource,
): source is PriceIsRightWeekdaySpinSource | PriceIsRightHeavyHitterSpinSource {
  return (
    source?.kind === "price_is_right_raffle" ||
    source?.kind === "price_is_right_heavy_hitter"
  );
}
